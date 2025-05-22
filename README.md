# RAILGUN as a blockchain

I often describe RAILGUN as a blockchain in a blockchain. Why do I find this model so important? Because it guides the thinking around what a RAILGUN SDK must be capable of, or rather what a RAILGUN client must do.  Since RAILGUN is a privacy preserving financial system, care must be taken at every step to limit the metadata exposed (leaky side channels). To be able to transact on RAILGUN also requires replicating a number of on-chain data structures to be able to produce valid proofs and scan for UTXOs (ie wallet balance). The easiest way to do this is to create a local copy. That's not to say there can't be made clever optimisations in the future. Initial ideas that spring to mind is to only scan `Nullified` events, and store the ones relevant to the client, but not keep all of them. Another potential optimisation along the same line of thinking is to only keep a sparse Merkle tree of note commitments, with paths to the notes that are relevant to the client. But I digress.

# Parallels to EVM blockchains

Let's draw some parallels between RAILGUN and EVM blockchains:

- **Total order**: EVM blockchains have a total order (ie. a global sorting) of everything that happened. For transactions it goes `[blockNumber, transactionIndex, ...traceAddress]` and logs (ie. events) have `[blockNumber, logIndex]`. RAILGUN Notes have a similar global position in `[treeNumber, treePosition]`, where as transactions, because they can have multiple inputs and multiple outputs, are positioned by `[treeNumber, treeStartPosition]`.
- **Unique identifier**: EVM blocks can be identified by their `blockHash` and transactions by their `transactionHash`. These identifiers are globally unique, but do not contain any information about their position in the chain. Likewise RAILGUN transactions have `txid` defined as `Poseidon(...nullifiers, ...commitments, boundParamsHash)` and notes have their `commitment` defined as `Poseidon(npk, tokenId, value)`.
- **Consensus**: EVM chains have validator sets in various forms (decentralised, sequencer etc.) that execute native code according to a spec, with punishment mechanisms to prevent deviations from the spec, while RAILGUN piggybacks on the underlying chain and checks ZK proofs in a smart contract. This is very similar to the proposed “Based Rollups”.
- **Double spend**: EVM chains perform balance checks, while RAILGUN checks that a nullifier has not been used.
- **Trust**: EVM chains maintain a succession of hashes that can be verified from genesis, while RAILGUN maintains a set of merkle roots for each note commitment tree.
- **State Root**: Ethereum blocks contain a global state root that represents the root of a Merkle proof over all state changes in Ethereum. Not all EVM chains have adopted such a global verifier, but RAILGUNs' merkle root verifies a similar concept, in that it covers all valid note commitments added to the system. For ZK efficiency reasons, there is not one canonical root, but a series of roots across note commitment trees.
- **Proof of spendability**: EVM chains verify signatures by recovering the public key used to sign a transaction and check it against the address to spend from. RAILGUN uses ZK proofs with public inputs to bind the proofs with "consensus state".
- **Blocks/Batches**: EVM chains batch transactions in blocks as a tradeoff between execution speed and consensus overhead. Since RAILGUN relies on the underlying chain for execution it does not have a concept of blocks, but it does process arrays of shields or transactions (which can be transfers or unshields), and it's consensus state updates in these batches. Batches can either be used by a singular entity to eg. shield multiple different tokens at once, or can be used as a gas amortisation mechanism to execute several unrelated transactions at once.
- **Addresses**: EVM chains are account based around an address, which is a truncated hash of the public key that can spend from the address. RAILGUN has `0zk` addresses that are encoded data structures with the required information to send funds to the owner, but are indirectly linked to spending funds.
- **Funds**: RAILGUN is more similar to ZCash than it is to Ethereum, since RAILGUN is TXO based, meaning funds are not accumulated under an account in a fungible way, but each transaction generates a number of notes that represent a token value. Note here is to be understood as banknote and not a written message. Notes must be used wholly, leading to a number of complications in managing the available funds to spend (UTXOs), unlike an account based model that accumulates.

# Syncing RAILGUN state

RAILGUN contracts are currently deployed in three versions, `v1`, `v2` and `v2.1`. Most information needed to build local data structures required for transacting on RAILGUN can be retrieved from EVM logs. However, to derive `txid`s the input parameters of a transaction are needed. Let's first take a step back and look at what a RAILGUN data model on EVM looks like:
![[RAILGUN Blockchain.png]]
The above diagram shows a `transact` call to `v2.1`. At the top an EVM block encapsulates any number of EVM transactions. An EVM transaction encapsulates any number of RAILGUN transaction batches, which contains a number of RAILGUN transactions. Note how the events are attached to the EVM transaction and not RAILGUN transactions. It is also important to reiterate that an EVM transaction may contain any number of RAILGUN transaction batches, meaning EVM logs contain events from several independent calls to RAILGUN contracts.

## Normalised GrahQL schema

For the purpose of exposing this raw information over GraphQL (eg. Subsquid), one could create the following model:

[`normalized_evm.graphql`](graphql/normalized_evm.graphql)
```graphql
type EVMBlock {
  number: BigInt!
  "Seconds since UNIX epoch"
  timestamp: Int!
  "32 byte block hash"
  hash: Bytes!

  "Transactions made by EOAs"
  transactions: [EVMTransaction!]!
}

type EVMTransaction {
  "32 byte transaction hash"
  hash: Bytes!
  "Transaction position within a block"
  index: Int!
  "Equivalent to tx.origin/ORIGIN"
  from: Address!
  "Nullable, as the transaction may not be a direct call to RAILGUN, but an intermediate smart contract such as RelayAdapt"
  input: RailgunFunctions

  "RAILGUN events emitted from this transaction"
  logs: [EVMLog!]!

  "Nullable field. If the transaction is not directly to RAILGUN, the relevant transactions will be nested as internal. Note that internal transactions are not directly visible, but need tracing to be retrieved"
  internalTransactions: [RailgunTransactionBatch!]
}

type EVMLog {
  "Log indexes are scoped per block and not per transaction, but still provide a total order"
  index: Int!
  "Should always be a RAILGUN contract address"
  address: Address!

  "As we are only interested in RAILGUN events, this field will always decode to one of the defined event types"
  log: RailgunEvents!
}

type RailgunTransactionBatch {
  "List of indexes to internal transactions, showing the path that ultimately called a RAILGUN function"
  tracePath: [Int!]!
  
  "Equivalent to msg.sender / CALLER"
  from: Address!
  "As we only decode internal transactions that are calls to RAILGUN, this will always be one of the RAILGUN call args"
  input: RailgunFunctions!
}
```

The above form is fully normalised, with each type representing its logical equivalent as outlined in the diagram above. This is a "low-level" representation, and includes all the information available on-chain. It has only undergone superficial processing in decoding relevant events and call args, which is within the capabilities of any eth JSON-RPC client. However it requires some refinement to be useful.

For example, commitments are emitted as one batch event, while attributing them directly to transactions requires some book keeping. The above schema is also very verbose to query, eg.:

```graphql
query {
  blocks {
    number
    timestamp

    transcations {
      index
      input

      logs {
        log {
          ... on ECommitmentBatchV1 {

          }
          ... on EGeneratedCommitmentBatchV1 {

          }
        }
      }

      internalTransactions {
        tracePath

        input {
          ... on GenerateDepositV1 {

          }
          ... on TransactV1 {

          }
        }
      }
    }
  }
}
```

Leading to accesses such as `result.data.blocks[0].transactions[0].internalTransactions[0].input`. 

## Denormalised GrahpQL Schema

Consuming RAILGUN data is perhaps more ergonomic in a denormalised form such as:

[`denormalized_evm.graphql`](graphql/denormalized_evm.graphql)
```graphql
type RailgunTransactionBatch {
  "Ordering information"
  blockNumber: BigInt!
  blockTimestamp: Int!
  transactionIndex: Int!
  "Nullable"
  tracePath: [Int!]

  "Inline tx accountability"
  origin: Address!
  from: Address!

  "Logs here will need to be attributed to the correct internal transaction. Ie. One can’t just naively add all emitted events from a given transaction hash in case they came from separate internal calls to railgun"
  logs: [EVMLog!]!

  "Call args"
  input: RailgunFunctions!
}
```

```graphql
query {
  transactionBatchs {
    blockNumber
    blockTimestamp
    transactionIndex
    tracePath

    origin
    from

    logs {
      log {
        ... on ECommitmentBatchV1 {
          __typename

        }
        ... on EGeneratedCommitmentBatchV1 {

        }
      }
    }

    input {
      ... on GenerateDepositV1 {

      }
      ... on TransactV1 {

      }
    }
  }
}
```


This format still requires local transformation to map to relevant RAILGUN concepts, but is very close to the actual blockchain data. One consideration here is that it also makes reorgs easier to handle, as the whole batch can be inverted, rather than if further processing was applied to split a batch into individual RAILGUN transactions.

While the normalised format stays true to the raw blockchain data, it still requires downstream consumers to handle all the special cases between various versions of shields, transactions and unshields. For example does `v1` not directly emit an `Unshield` event like `^v2` does, but it can be inferred by processing the underlying `ERC20` `Transfer` events. Another similar example is `v2` does not include `fees` in the `Shield` event while `v2.1` does. 

# Abstract denormalised form

Papering over the differences between the different versions of RAILGUN requires one to abstract away their differences into a canonical format. The open question here is whether such abstractions can be made in a way that is not leaky, ie can one make a `Unshield` type that captures all the information for each version and still infer what is not directly emitted, such that we avoid `null` values entirely as special cases. Branching control flow is the most prevalent source of bugs, and pushing downstream the decision of what to do with missing data amplifies this confusion, even with good documentation. This does not imply the nullable fields are entirely banned. Some structures will per definition have nullable fields, for example can a transaction have at most one unshield, but it may have none if it’s an internal transfer. 

In the appendix each `struct`, `event` and `function` relevant to RAILGUN transactions has been converted to GraphQL types. Let now look at each in turn and how we could represent a transformed format that encapsulates all versions under one shared format. For each type, the respective function with its call arguments and events emitted will be presented in a pseudo code format to highlight the data that can be captured and a format is proposed at the end.

### WIP below

## `Shield`

In `v1` shielding was called a deposit, invoked trough `generateDeposit`, while `v2` changed the nomenclature to shielding. 

### `v1`

Below is a pseudo 
```
function generateDeposit = {
  notes: Array<{
    encryptedRandom: bytes32[2],
    note: {
      npk: bytes32,
      value: uint120,
      token: {
        tokenType: enum TokenType,
        address: Address,
        tokenSubID: uint256
      }
    }
  }>
}

event CommitmentBatch
```
## `Transact`

Transacting is quite similar in each version. While technically unshields are a special case of transacting, we treat it as its own type here, as described in the next section.

## `Unshield`
