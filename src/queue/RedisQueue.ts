import { SharedStoreQueue, SharedStoreQueueItem, ReduxStore, SharedStoreAction } from "./SharedStoreQueue";

export class LocalQueue implements SharedStoreQueue {
    private queue: SharedStoreQueueItem[] = [];
    private store: any = {};
    private present: any = {};

    init(store: ReduxStore) {
        this.present = {version: 0, state: store.getState()};
        this.store = store
    }

    async enqueue(client: string | null, action: SharedStoreAction): Promise<void> {
        this.queue.unshift({ client, action })
    }

    async getNext(): Promise<SharedStoreQueueItem|undefined> {
        return this.queue.pop()
    }

    async savePresent(store: any): Promise<void> {
        this.store = store;
    }

    async loadPresent(): Promise<any> {
        return this.store
    }
}