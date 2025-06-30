/* eslint-ignore-file */
declare module 'upsert-map' {
  /**
   * A Map with an upsert method that is like a "get or set" method. Also supports gc'ing empty upserts.
   */
  export default class UpsertMap<K, V> {
    /**
     * Make a new upsert map.
     * @param createValue - should return a value to be upserted for a key.
     * @param isEmpty - can optionally be added for auto gc of empty values.
     */
    constructor (create: (key: K) => V, isEmpty: (val: V) => boolean)

    /**
     * Similar to Map.size
     */
    get size (): number

    /**
     * Similar to Map[Symbol.iterator]
     */
    [Symbol.iterator] (): MapIterator<[K, V]>
    /**
     * Similar to Map.values
     */
    values (): MapIterator<V>
    /**
     * Similar to Map.entries
     */
    keys (): MapIterator<K>

    /**
     * Returns the value for key if already exists, otherwise it is created and inserted into the map.
     * @param key The key to upsert.
     */
    upsert (key: K): V
    /**
     * Similar to Map.set
     */
    set (key: K, value: V): void
    /**
     * Similar to Map.get
     */
    get (key: K): V | undefined
    /**
     * Similar to Map.has
     */
    has (key: K): boolean
    /**
     * Similar to Map.delete, however does not return a boolean for whether the key was found.
     */
    delete (key: K): void
    /**
     * Manually trigger gc of empty entries.
     */
    gc (): void
  }
}
