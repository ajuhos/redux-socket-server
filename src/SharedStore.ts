import { PRESENT, ADD_CLIENT } from 'redux-socket-client';
import { EventEmitter } from 'events';
import {SharedStoreQueue, LocalQueue, ReduxStore} from "./queue";
import * as SocketIO from "socket.io";

//TODO: Handle messages for previous connection: introduce a connection id.

export class SharedStore extends EventEmitter {
    readonly dispatch: (action: any) => void;
    readonly dispatchToClient: (clientId: string, action: any) => void;

    private async init(io: SocketIO.Server, store: ReduxStore, queue: SharedStoreQueue) {
        await queue.init(store);
        let present = await queue.loadPresent();

        function extractPresent(id: string, isManager: boolean) {
            if(isManager) return present;

            const { state, version } = present;
            const subState = {
                shared: state.shared,
                client: state.clients[state.clients.mappings[id]]
            };
            return { state: subState, version }
        }

        (async function processQueue() {
            let item = await queue.getNext();
            while (item) {
                const { action, client } = item;
                store.dispatch(action);
                present = {version: present.version + 1, state: store.getState()};
                await queue.savePresent(present);

                if(client) {
                    console.log('client action', action);
                    io.to(client).emit('action', {action, version: present.version});
                    io.to('managers').emit('action', {action, client, version: present.version});
                    io.emit('version', present.version)
                }
                else {
                    console.log('action', action);
                    io.emit('action', {action, version: present.version})
                }

                this.emit('action', action, client, present);

                item = await queue.getNext();
            }
            setImmediate(processQueue)
        })();

        const clients: string[] = [];
        io.on('connection', (socket: any) => {
            console.log('client connected', socket.id);
            this.emit('authentication', socket, (manager: boolean, clientId: string = socket.id) => {
                socket.join(clientId);
                if(manager) socket.join('managers');

                if(clients.indexOf(clientId) === -1) {
                    clients.push(clientId);
                    if (!manager) {
                        queue.enqueue(clientId,{type: ADD_CLIENT, payload: { id: clientId }})
                    }
                }

                socket.on('present', () => socket.emit('present', extractPresent(clientId, manager)));
                socket.on('action', this.dispatch);
                //TODO: How to send client actions from manager
                socket.on('client-action', this.dispatchToClient.bind(this, clientId));

                socket.emit('present', extractPresent(clientId, manager))
            });
        });
    }

    constructor(io: SocketIO.Server, store: ReduxStore, queue: SharedStoreQueue = new LocalQueue) {
        super();

        this.dispatch = (action: any) => {
            if (!action || action.type === PRESENT) return;
            queue.enqueue(null, action)
        };

        this.dispatchToClient = (clientId: string, action: any) => {
            if (!action || action.type === PRESENT) return;
            queue.enqueue(clientId, action)
        };

        this.init(io, store, queue)
    }
}