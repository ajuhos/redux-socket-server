export interface SharedStoreAction {
    type: string,
    payload: any
}

export interface SharedStoreQueueItem {
    client: string|null,
    action: SharedStoreAction
}

export interface SharedStorePresent {
    version: number,
    state: {
        shared: any,
        clients: {
            items: any[],
            mappings: { [key:string]: number }
        }
    }
}

export interface SharedStoreQueue {
    init(store: ReduxStore): Promise<void>;
    enqueue(client: string|null, action: SharedStoreAction): Promise<void>
    getNext(): Promise<SharedStoreQueueItem|undefined>
    savePresent(store: SharedStorePresent): Promise<void>
    loadPresent(): Promise<SharedStorePresent>
}

export interface ReduxStore {
    getState(): any
    dispatch(action: SharedStoreAction): void
}