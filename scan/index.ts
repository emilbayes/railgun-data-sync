import * as ABIs from '@railgun-reloaded/contract-abis'

import networkUpgrades from '../upgrades.json'

/**
 *
 * @param a
 * @param b
 */
function min (a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

/**
 *
 * @param start
 * @param end
 * @param step
 */
function * range (start: bigint, end: bigint, step: bigint): Iterable<[bigint, bigint]> {
  let current = start

  while (current <= end) {
    const rangeEnd = min(current + step - 1n, end)
    yield [current, rangeEnd]
    current += step
  }
}

type NetworkUpgrade = {
  address: string
  upgrades: {
    name: 'v1' | 'v2' | 'v2.1'
    from: string
    to: string
    txIndex: number
    txHash: string
  }[]
}

const eth = networkUpgrades.ethereum as NetworkUpgrade

let i = 0
/**
 *
 * @param method
 * @param params
 */
function jsonrpc (method: string, params: any) {
  return {
    jsonrpc: '2.0',
    id: i++,
    method,
    params: [params]
  }
}

const RPC_URL = process.env.RPC_URL

const chunkSize = 500n
const nameToAbi = new Map([
  ['v1', ABIs.RailgunV1],
  ['v2', ABIs.RailgunV2],
  ['v2.1', ABIs.RailgunV2_1]
])

  ; (async () => {
    for (const upgrade of eth.upgrades) {
      const address = eth.address
      const ABI = nameToAbi.get(upgrade.name)!

      console.log(ABI.length)
      const reqQueue = []
      for (const [start, end] of range(BigInt(upgrade.from), BigInt(upgrade.to), chunkSize)) {
        const fromBlock = '0x' + start.toString(16)
        const toBlock = '0x' + end.toString(16)

        const filter = {
          fromBlock,
          toBlock,
          address,
          topics: []
        }
        reqQueue.push(jsonrpc('eth_getLogs', filter))

        const data = await req(reqQueue)

        // clear queue
        reqQueue.length = 0

        console.log(`Processing upgrade ${upgrade.name} from block ${start} to ${end}...`)
        if (data.error) {
          console.error(`Error fetching logs: ${data.error.message}`)
          throw new Error(`Failed to fetch logs for upgrade ${upgrade.name}`)
        }

        // first n items of results are txs, the last item is always the logs
        for (const { result: tx } of data.slice(0, -1)) {
          console.log(`Processing tx ${tx.hash}...`)
          console.dir(tx)
        }

        const txHashes = new Set<string>()
        data.at(-1)?.result.forEach((log: any) => {
          console.log('Processing log:', log)

          txHashes.add(log.transactionHash)
        })

        for (const txHash of txHashes) {
          reqQueue.push(jsonrpc('eth_getTransactionByHash', txHash))
        }
      }
      break
    }
  })()

/**
 *
 * @param batch
 * @param tries
 */
async function req (batch: any, tries = 3) {
  if (tries <= 0) throw new Error('Failed to fetch logs after multiple attempts')

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(batch)
  })

  const data = await res.json()

  if (data.error) {
    console.error(`Error fetching logs: ${data.error.message}`)
    await new Promise(resolve => setTimeout(resolve, 1000)) // wait before retrying
    return req(batch, tries - 1)
  }

  return data
}
