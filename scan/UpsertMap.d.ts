/* eslint-ignore-file */
declare module 'upsert-map' {
  export default class UpsertMap<K, V> {
    constructor(create: (key: K) => V, isEmpty: (val: V) => boolean)

    get size(): number

    [Symbol.iterator](): MapIterator<[K, V]>
    values(): MapIterator<V>
    keys(): MapIterator<K>

    upsert(key: K): V
    set(key: K, value: V): void
    get(key: K): V | undefined
    has(key: K): boolean
    delete(key: K): void
    gc(): void
  }
}

