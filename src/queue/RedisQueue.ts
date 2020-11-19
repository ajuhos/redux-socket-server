import {
    SharedStoreQueue,
    SharedStoreQueueItem,
    ReduxStore,
    SharedStoreAction,
    SharedStorePresent
} from "./SharedStoreQueue";
import {Redis} from 'ioredis';
import {PRESENT} from "redux-socket-client";
import * as Redlock from "redlock";
import {EventEmitter} from "events";
import {PubSub} from "../ioredis-pubsub";
const debug = require('debug')('redux-socket-server');

export class RedisQueue extends EventEmitter implements SharedStoreQueue  {
    private readonly queue: SharedStoreQueueItem[] = [];
    private readonly redis: Redis;
    private readonly pubsub: any;
    private readonly prefix: string;
    private store: any = {};
    private present: any = {};
    private lock: Redlock.Lock|null = null;
    private lockInterval: any;
    private redlock: Redlock;

    lockTTL = 1000;

    constructor(redisPub: Redis, redisSub: Redis, prefix: string = '') {
        super();

        this.redis = redisPub;
        this.pubsub = new PubSub(redisPub, redisSub, prefix);
        this.prefix = prefix ? `${prefix}:` : '';

        this.redlock = new Redlock(
            [ redisPub ],
            {
                // the expected clock drift; for more details
                // see http://redis.io/topics/distlock
                driftFactor: 0.01,
                retryCount:  0
            });

        this.pubsub.on('action', (item: SharedStoreQueueItem) => {
            if(this.lock) return;
            this.queue.unshift(item);

            debug(`[${this.prefix}] action added to local queue: ${item.action.type} (${item.client || 'no client'})`)
        })
    }

    private initLock(lock: Redlock.Lock) {
        if(this.lock) return;

        this.lock = lock;
        this.lockInterval = setInterval(() => lock.extend(this.lockTTL).catch((e) => {
            debug(`[${this.prefix}] lost lock`, e);
            this.cancelLock()
        }), this.lockTTL / 5);

        try {
            this.emit('lock');
        }
        catch (e) {
            debug(`[${this.prefix}] error in lock event handler`, e)
        }

        debug(`[${this.prefix}] acquired lock`)
    }

    private cancelLock() {
        if(!this.lock) return;
        clearInterval(this.lockInterval);
        this.lock = this.lockInterval = null
    }

    private acquireLock() {
        return new Promise(resolve => {
            if(this.lock) return resolve(true);

            this.redlock.lock(this.prefix + 'lock', this.lockTTL)
                .then(lock => {
                    this.initLock(lock);
                    resolve(true)
                })
                .catch(() => resolve(false))
        })
    }

    async init(store: ReduxStore) {
        return new Promise<void>((resolve, reject) => {
            this.store = store;

            this.redis.get(this.prefix + 'present', async (err, data) => {
                if (err) {
                    debug(`[${this.prefix}] failed to init`);
                    return reject(err)
                }

                if (data) {
                    this.present = JSON.parse(data);
                    store.dispatch({ type: PRESENT, payload: this.present });

                    debug(`[${this.prefix}] init from existing present`)
                }
                else {
                    this.present = { version: 0, state: store.getState() };
                    await this.savePresent(this.present);

                    debug(`[${this.prefix}] init from scratch`)
                }

                resolve()
            })
        })
    }

    enqueue(client: string | null, action: SharedStoreAction) {
        return new Promise<void>((resolve, reject) => {
            this.redis.lpush(this.prefix + 'queue', JSON.stringify({client, action}), (err) => {
                if (err) {
                    debug(`[${this.prefix}] failed to enqueue`);
                    return reject(err)
                }
                resolve();

                debug(`[${this.prefix}] enqueued action: ${action.type} (${client || 'no client'})`)
            })
        })
    }

    getNext(): Promise<SharedStoreQueueItem|undefined> {
        return new Promise(async (resolve, reject) => {
            if(await this.acquireLock()) {
                this.redis.rpop(this.prefix + 'queue', (err, rawData) => {
                    if (err) {
                        debug(`[${this.prefix}] failed to get next`);
                        return reject(err)
                    }

                    const data = rawData ? JSON.parse(rawData) : undefined;
                    resolve(data);

                    if(data) {
                        this.pubsub.emit('action', data);

                        debug(`[${this.prefix}] received action: ${data.action.type} (${data.client || 'no client'})`)
                    }
                })
            }
            else {
                const data = this.queue.pop();
                resolve(data);

                if(data) {
                    debug(`[${this.prefix}] received action: ${data.action.type} (${data.client || 'no client'})`)
                }
            }
        })
    }

    async savePresent(data: SharedStorePresent) {
        return new Promise<void>(async (resolve, reject) => {
            this.present = data;

            if(await this.acquireLock()) {
                this.redis.set(this.prefix + 'present', JSON.stringify(data), (err) => {
                    if (err) {
                        debug(`[${this.prefix}] failed to save present`);
                        reject(err);
                    }
                    else {
                        debug(`[${this.prefix}] saved present`, 'v'+data.version, data.state);
                        resolve()
                    }
                })
            }
            else {
                //We don't have permission to persist present.
                resolve()
            }
        })
    }

    async loadPresent(): Promise<any> {
        return new Promise<void>((resolve, reject) => {
            this.redis.get(this.prefix + 'present', async (err, data) => {
                if (err) {
                    debug(`[${this.prefix}] failed to load present`);
                    return reject(err);
                }

                if (data) {
                    this.present = JSON.parse(data);
                    resolve(this.present)
                }
                else if(this.present) {
                    resolve(this.present)
                }
                else {
                    reject(new Error('No data found in Redis.'))
                }
            })
        })
    }

    async clean() {
        this.redis.del(this.prefix + 'queue');
        this.redis.del(this.prefix + 'present');
        this.cancelLock();

        debug(`[${this.prefix}] cleanup done`)
    }
}