### Redux Socket Server

Lightweight framework for building distributed redux stores using socket.io.

## Features
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fajuhos%2Fredux-socket-server.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fajuhos%2Fredux-socket-server?ref=badge_shield)


 - Shared store and actions with a single middleware
 - Managers and clients for advanced scenarios
 - Permission management
 - Server-side broadcast
 - Synchronisation using locks

## Installation

**Redux Socket Server is in ``beta`` and NOT ready for production use.**

To install the latest version, use NPM:

```bash
$ npm install redux-socket-server
```

## Basics

The primary aim of this component is to provide a distributed redux store for
real time web apps running on multiple devices at the same time. With a distributed
store a group of clients and the server (which can be a cluster) can share a redux store. 

This means that an action dispatched at a client, can cause a change at other clients, or
can have an effect on the server. This concept can be useful for distributing changes 
real time across the devices of a single user, or for real time collaboration apps.

The distributed store has a predefined base structure and actions can be tagged to be
distributed, otherwise the distributed store works just like any ordinary redux store,
both on the client and the server.

### Store Structure

The distributed store consists of two parts: `shared` and `clients`. The former provides
a shared storage, which is available for every client, while the latter is the list of the
client-specific stores. Every client has access to it's own store, while managers and the 
server has access to whole list of client stores. Also managers and the server, has write 
access to the shared part, while other clients only have read access.

The content of the shared part and each client part are specified by the application.

The store from a **standard client**:

```javascript
{ 
    shared: { 
        // Read-only data, same for every client    
    }, 
    client: { 
        id: 'client-a',
        // Unique data of this client (also available on the server)   
    },
    // Anything else, only available locally for this client  
}
```

The store from a **manager client** or a **server node**:

```javascript
{ 
    shared: { 
        // Shared data with write access
    }, 
    clients: { 
        items: [
            {
                id: 'client-a',
                //Unique data of Client A
            },
            {
                id: 'client-b',
                //Unique data of Client B
            }
        ],
        mappings: {
            'client-a': 0,
            'client-b': 1
        } 
    },
    // Anything else, only available locally
}
```

### Actions and reducers

A standard redux action will only be executed locally, as always. To make it 
distributed, it have to be tagged as a `client` or a `shared` action.

Both tags will transfer the action to the server, but for permission management 
to function as expected, it is recommended to make sure `client` actions has no
direct effect on the shared part of the store. (Of course `shared` actions can 
have an effect on the client part too.)

To tag an action, it's action creator must be tagged on declaration:

```javascript
import { client, shared } from 'redux-socket-client';

export const addPrivateNote = client((value) => ({
    type: 'ADD_PRIVATE_NOTE',
    payload: {
        note: value
    }
}));

export const addPublicNote = shared((value) => ({
    type: 'ADD_PUBLIC_NOTE',
    payload: {
        note: value
    }
}));
```

Reducers work just like in a normal react app, except, here distributed reducers
will be executed not just on every client, but also on every server node. Also
there are some predefined actions, which must be handled correctly:
 
 - `PRESENT`: When a client (including managers) connects to the server, the 
 current distributed state will be retrieved from the server node as a PRESENT action.
 - `ADD_CLIENT`: When a non-manager client connects to the server, the ADD_CLIENT 
 action will be dispatched. The reducer must initialize the client part as the effect
 of this action.

You should provide at least one reducer for each part of the store. While the shared
reducer is straightforward, the client reducer MUST be implemented to handle a single
client and not the array of clients.

The minimal client reducer:

```javascript
import { ADD_CLIENT, PRESENT } from 'redux-socket-client';

export const client = (state = {}, action) => {
    switch(action.type) {
        case ADD_CLIENT:
            return {
                id: payload.id,
                ...payload.details
                // Anything else you need for every client store...
            }

        case PRESENT:
            return payload.state.client

        default:
            return state
    }
}
```

The minimal shared reducer:

```javascript
import { PRESENT } from 'redux-socket-client';

export const shared = (state = {}, action) => {
    switch(action.type) {
        case PRESENT:
            return payload.state.shared

        default:
            return state
    }
}
```

## Setup

### Setup in React apps

The store setup in react apps is mostly the same as for normal react apps, the only
important exception is the `sharedStoreMiddleware`, which handles tagged actions.

Setup for **standard clients**:

```javascript
import {createStore, applyMiddleware, combineReducers} from 'redux';
import {sharedStoreMiddleware} from 'redux-socket-client';
import {connect} from 'socket.io-client';
import {shared, client} from './reducers';

const socket = connect('wss://...');

const store = createStore(
    combineReducers({ shared, client }),
    applyMiddleware(sharedStoreMiddleware(socket, { clientFirst: true }))
)
```  

If it is important to execute actions on client side as soon as possible, you should add
`{ clientFirst: true }`, otherwise actions will be sent to the server and only executed 
on the client, once the server processed and sent those back.

Setup for **manager clients**:

```javascript
import {createStore, applyMiddleware, combineReducers} from 'redux';
import {sharedStoreMiddleware, combineClients} from 'redux-socket-client';
import {connect} from 'socket.io-client';
import {shared, client} from './reducers';

const socket = connect('wss://...');

this.store = createStore(
    combineReducers({ shared, clients: combineClients(client) }),
    applyMiddleware(sharedStoreMiddleware(socket))
)
```  

Please notice `clients: combineClients(client)`. This makes possible to handle the 
array of clients with the reducer built for single clients.

### Setup for server nodes

On the server side, you have to use the `SharedStore` class as a wrapper around your
redux store.

```javascript
import {createStore, combineReducers} from 'redux';
import {SharedStore, combineClients} from 'redux-socket-server';
import {shared, client} from './reducers';

const store = new SharedStore(
    io, //Your socket.io instance for communication with the clients.
    createStore(
        combineReducers({ shared, clients: combineClients(client) }),
        {
            shared: {
               // The initial state of the shared part of the store.
            }
        }
    ),
    queue // [optional] Distributed queue
);
```

If you use multiple server nodes, you must use a distributed queue implementation for
the store. A Redis based implementation is built into the library:

```javascript
import {RedisQueue} from 'redux-socket-server';

const queue = new RedisQueue(
    redisClient1,
    redisClient2, 
    'prefix' // [optional] Prefix to be used for redis keys. 
);
```

#### Authentication

The server must authenticate every socket connection before the store can be used by a
client.

```javascript
store.on('authentication', (socket, authorize) => {
    if(isAuthenticated(socket)) {
        authorize(
            isManager(socket),     // Decide whether this user is a manager.
            getUserId(socket),     // Provide an optional user id.
            getUserDetails(socket) // [optional] User details.
        )
    }
    else {
        //Kick out the unauthorized socket.
        socket.disconnect(true)
    }
});
```

If no user id is provided the socket id will be used instead, but to handle multiple sockets 
for the same user it must be provided.

## Server side reaction to actions

The `SharedStore` implementation supports almost every method specified by the Redux Store API:
 
 - `dispatch(action)`
 - `getState()`
 - `subscribe(listener)`
 
It also adds a custom method for dispatching actions to a specified client: `dispatchToClient(clientId, action)`, 
plus one for stopping the store: `stop()`.

Handling incoming actions on the server side can be implemented using `subscribe`, which provides
some useful parameters for the `listener`:
 - `action`: The action which caused the call of the listener
 - `clientId`: The id of the client, if it is an action tagged as `client`.
 - `prevPresent`: The previous state and version number. (`{ state: { shared, clients }, version }`)
 - `present`: The current state and version number. (`{ state: { shared, clients }, version }`)

If it is required to handle actions, or execute specific tasks only on a single master 
node, the `lock` event of the `RedisQueue` class can be used. This will be fired every
time a new master is selected:

```javascript
queue.on('lock', () => {
    // Actions/tasks only on the master node...
})
```

Once a master gets selected, it won't loose it status, unless it crashes. In this case
a new master will be assigned automatically within 1 second.

## License

The [MIT License](https://github.com/ajuhos/api-core/blob/master/LICENSE).
Free forever. :)

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fajuhos%2Fredux-socket-server.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fajuhos%2Fredux-socket-server?ref=badge_large)