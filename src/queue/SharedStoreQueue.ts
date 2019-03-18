export interface SharedStoreAction {
    type: string,
    payload: any
}

export interface SharedStoreQueueItem {
    client: string|null,
    action: SharedStoreAction
}

export interface SharedStoreQueue {
    init(store: ReduxStore): Promise<void>;
    enqueue(client: string|null, action: SharedStoreAction): Promise<void>
    getNext(): Promise<SharedStoreQueueItem|undefined>
    savePresent(store: any): Promise<void>
    loadPresent(): Promise<any>
}

export interface ReduxStore {
    getState(): any
    dispatch(action: SharedStoreAction): void
}