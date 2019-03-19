import { PRESENT, ADD_CLIENT, tags } from 'redux-socket-client';
import { EventEmitter } from 'events';
import {SharedStoreQueue, LocalQueue, ReduxStore, SharedStoreAction, SharedStorePresent} from "./queue";
import * as SocketIO from "socket.io";
const debug = require('debug')('redux-socket-server');
const { CLIENT } = tags;

//TODO: Handle messages for previous connection: introduce a connection id.

export class SharedStore extends EventEmitter {
    readonly dispatch: (action: any) => void;
    readonly dispatchToClient: (clientId: string, action: any) => void;
    readonly getState: () => any;

    private shouldStop = false;

    subscribe(listener: (action: SharedStoreAction, clientId: string|undefined, prevPresent: SharedStorePresent, present: SharedStorePresent) => void) {
        this.on('action', listener)
    }

    private async init(io: SocketIO.Server, store: ReduxStore, queue: SharedStoreQueue) {
        await queue.init(store);
        let present = await queue.loadPresent();

        function extractPresent(id: string, isManager: boolean) {
            if(isManager) return present;

            const { state, version } = present;
            const subState = {
                shared: state.shared,
                client: state.clients.items[state.clients.mappings[id]]
            };
            return { state: subState, version }
        }

        const processQueue = async () => {
            if(this.shouldStop) return;

            let item = await queue.getNext();
            while (item) {
                const { action, client } = item;
                store.dispatch(client ? { ...action, [CLIENT]: client } : action);

                const prevPresent = present;
                present = {version: present.version + 1, state: store.getState()};
                await queue.savePresent(present);

                if(client) {
                    debug('client action', action);
                    io.to(client).emit('action', {action, client, version: present.version});
                    io.to('managers').emit('action', {action, client, version: present.version});
                    io.emit('version', present.version)
                }
                else {
                    debug('action', action);
                    io.emit('action', {action, version: present.version})
                }

                try {
                    this.emit('action', action, client, prevPresent, present);
                }
                catch (e) {
                    debug(`error in action (${action.type}) event handler`, e)
                }

                item = await queue.getNext();
            }
            setImmediate(processQueue)
        };
        processQueue();

        io.on('connection', (socket: any) => {
            debug('client connected', socket.id);
            this.emit('authentication', socket, (manager: boolean, clientId: string = socket.id) => {
                socket.join(clientId);
                if(manager) socket.join('managers');

                debug('client authenticated', socket.id, '-->', clientId, manager ? '(manager)' : '');

                socket.on('action', this.dispatch);

                //TODO: How to send client actions from manager
                socket.on('client-action', this.dispatchToClient.bind(this, clientId));

                if(!manager && typeof present.state.clients.mappings[clientId] === 'undefined') {
                    //TODO: Better solution?
                    const setupClient = (action: SharedStoreAction, client: string) => {
                        if(action.type === ADD_CLIENT && client === clientId) {
                            EventEmitter.prototype.removeListener.call(this,'action', setupClient);
                            socket.on('present', () => socket.emit('present', extractPresent(clientId, manager)));
                            socket.emit('present', extractPresent(clientId, manager));

                            debug('client inited:', clientId);
                        }
                    };
                    this.on('action', setupClient);

                    queue.enqueue(clientId,{type: ADD_CLIENT, payload: { id: clientId }})
                }
                else {
                    socket.on('present', () => socket.emit('present', extractPresent(clientId, manager)));
                    socket.emit('present', extractPresent(clientId, manager));

                    if(manager) debug('manager connected:', clientId);
                    else debug('client reconnected:', clientId)
                }
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

        this.getState = () => store.getState();

        this.init(io, store, queue)
    }

    stop() {
        this.shouldStop = true
    }
}