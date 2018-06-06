import { PRESENT, ADD_CLIENT, tags } from 'redux-socket-client';
import { EventEmitter } from 'events';

const { CLIENT } = tags;

//TODO: Handle messages for previous connection: introduce a connection id.

export class SharedStore extends EventEmitter {
    readonly dispatch: (action: any) => void;
    readonly dispatchToClient: (clientId: string, action: any) => void;

    constructor(io: any, store: any) {
        super();

        let present = {version: 0, state: store.getState()};

        function extractPresent(id: string, isManager: boolean) {
            if(isManager) return present;

            const { state, version } = present;
            const subState = {
                shared: state.shared,
                client: state.clients.get(id)
            };
            return { state: subState, version }
        }

        const queue: any[] = [];
        (function processQueue() {
            while (queue.length) {
                const action = queue.pop();

                store.dispatch(action);
                present = {version: present.version + 1, state: store.getState()};

                if(action[CLIENT]) {
                    console.log('client action', action);
                    io.to(action[CLIENT]).emit('action', {action, version: present.version});
                    io.to('managers').emit('action', {action, client: action[CLIENT], version: present.version});
                    io.emit('version', present.version)
                }
                else {
                    console.log('action', action);
                    io.emit('action', {action, version: present.version})
                }
            }
            setImmediate(processQueue)
        })();

        io.on('connection', (socket: any) => {
            console.log('client connected', socket.id);
            this.emit('authentication', socket, (manager: any) => {
                socket.join(socket.id);

                if(manager) socket.join('managers');
                else {
                    queue.unshift({ type: ADD_CLIENT, [CLIENT]: socket.id })
                }

                socket.on('present', () => socket.emit('present', extractPresent(socket.id, manager)));
                socket.on('action', this.dispatch);
                //TODO: How to send client actions from manager
                socket.on('client-action', this.dispatchToClient.bind(this, socket.id));

                socket.emit('present', extractPresent(socket.id, manager))
            });
        });

        this.dispatch = (action: any) => {
            if (!action || action.type === PRESENT) return;
            queue.unshift(action)
        };

        this.dispatchToClient = (clientId: string, action: any) => {
            if (!action || action.type === PRESENT) return;
            action[CLIENT] = clientId;
            queue.unshift(action)
        }
    }
}