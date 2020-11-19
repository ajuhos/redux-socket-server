import {Redis} from "ioredis";

type ListenerFunc = (...args: any[]) => void;
export class PubSub {
    private scope: string;
    private redisEmitter: Redis;
    private redisReceiver: Redis;
    private subscriptions: Map<string, ListenerFunc[]>;

    emit(channel: string, data: any) {
        this.redisEmitter.publish(`${this.scope}:${channel}`, JSON.stringify(data));
    }

    on(channel: string, listener: ListenerFunc) {
        const ch = `${this.scope}:${channel}`;
        if (!this.subscriptions.has(ch))
            this.subscriptions.set(ch, []);
        const entry = this.subscriptions.get(ch);
        if (entry) {
            this.redisReceiver.subscribe(ch);
            entry.push(listener);
        }
    }

    private handleSub(channel: string, message: string) {
        const listeners = this.subscriptions.get(channel);
        if (listeners && listeners.length) {
            const value = JSON.parse(message);
            listeners.map(l => l(value));
        }
    }

    constructor(redisEmitter: Redis, redisReceiver: Redis, prefix: string) {
        this.scope = prefix;
        this.redisEmitter = redisEmitter;
        this.redisReceiver = redisReceiver;
        this.subscriptions = new Map<string, ListenerFunc[]>();
        this.redisReceiver.on("message", this.handleSub.bind(this));
    }
}
