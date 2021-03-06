const assert = require('chai').assert
const ffi = require('ffi')
const vcx = require('../dist/index')
const { stubInitVCX, shouldThrow } = require('./helpers')
const { Connection, Proof, StateType, Error, ProofState, rustAPI, VCXMock, VCXMockMessage } = vcx

const connectionConfigDefault = { id: '234' }
const schemaKey1 = {name: 'schema name', did: 'schema did', version: '1.0'}
const restrictions1 = {issuerDid: '8XFh8yBzrpJQmNyZzgoTqB', schemaKey: schemaKey1}
const ATTR = [{name: 'test', restrictions: [restrictions1]}]
const PROOF_MSG = '{"version":"0.1","to_did":"BnRXf8yDMUwGyZVDkSENeq","from_did":"GxtnGN6ypZYgEqcftSQFnC","proof_request_id":"cCanHnpFAD","libindy_proof":"{}"}'

const proofConfigDefault = { sourceId: 'proofConfigDefaultSourceId', attrs: ATTR, name: 'TestProof' }

describe('A Proof', function () {
  this.timeout(30000)

  before(async () => {
    stubInitVCX()
    await vcx.initVcx('ENABLE_TEST_MODE')
  })

  it('can be created.', async () => {
    const proof = new Proof('Proof ID', { attrs: ATTR, name: 'TestProof' })
    assert(proof)
  })

  it('can have a source Id.', async () => {
    const proof = new Proof('Proof ID', { attrs: ATTR, name: 'TestProof' })
    assert.equal(proof.sourceId, 'Proof ID')
  })

  it('has a proofHandle and a sourceId after it is created', async () => {
    const sourceId = '1'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    assert(proof.handle)
    assert.equal(proof.sourceId, sourceId)
  })

  it('has state of Initialized after creating', async () => {
    const sourceId = 'Proof ID'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    assert.equal(await proof.getState(), StateType.Initialized)
  })

  it('can be created, then serialized, then deserialized and have the same sourceId and state', async () => {
    const sourceId = 'SerializeDeserialize'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    const jsonProof = await proof.serialize()
    assert.equal(jsonProof.state, StateType.Initialized)
    const proof2 = await Proof.deserialize(jsonProof)
    assert.equal(proof.sourceId, proof2.sourceId)
    assert.equal(await proof.getState(), await proof2.getState())
  })

  it('will throw error on serialize when proof has been released', async () => {
    const sourceId = 'SerializeDeserialize'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    const jsonProof = await proof.serialize()
    assert.equal(await proof.getState(), StateType.Initialized)
    let data = await proof.serialize()
    assert(data)
    assert.equal(data.handle, jsonProof.handle)
    assert.equal(await proof.release(), Error.SUCCESS)
    const error = await shouldThrow(() => proof.serialize())
    assert.equal(error.vcxCode, 1017)
    assert.equal(error.vcxFunction, 'Proof:serialize')
    assert.equal(error.message, 'Invalid Proof Handle')
  })

  it('has correct state after deserializing', async () => {
    const sourceId = 'SerializeDeserialize'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    const jsonProof = await proof.serialize()
    const proof2 = await Proof.deserialize(jsonProof)
    assert.equal(await proof2.getState(), StateType.Initialized)
  })

  const proofSendOffer = async ({
    connectionConfig = connectionConfigDefault,
    proofConfig = proofConfigDefault
  } = {}) => {
    const connection = await Connection.create(connectionConfig)
    await connection.connect()
    const proof = await Proof.create(proofConfig)
    await proof.requestProof(connection)
    assert.equal(await proof.getState(), StateType.OfferSent)
    return {
      connection,
      proof
    }
  }
  it('has state of OfferSent after sending proof request', async () => {
    await proofSendOffer()
  })

  const acceptProofOffer = async ({ proof }) => {
    VCXMock.setVcxMock(VCXMockMessage.Proof)
    VCXMock.setVcxMock(VCXMockMessage.UpdateProof)
    await proof.updateState()
    const newState = await proof.getState()
    assert.equal(newState, 4)
  }
  it(`updating proof's state with mocked agent reply should return 4`, async () => {
    const { proof } = await proofSendOffer()
    await acceptProofOffer({ proof })
  })

  it('requesting a proof throws invalid connection error with released connection', async () => {
    let connection = await Connection.create({ id: '234' })
    await connection.connect()
    await connection.release()
    const sourceId = 'SerializeDeserialize'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    const error = await shouldThrow(() => proof.requestProof(connection))
    assert.equal(error.vcxCode, 1003)
    assert.equal(error.vcxFunction, 'vcx_proof_send_request')
    assert.equal(error.message, 'Invalid Connection Handle')
  })

  it('requesting a proof throws invalid proof error with released proof', async () => {
    let connection = await Connection.create({ id: '234' })
    await connection.connect()
    await connection.release()
    const sourceId = 'SerializeDeserialize'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    await proof.release()
    const error = await shouldThrow(() => proof.requestProof(connection))
    assert.equal(error.vcxCode, 1017)
    assert.equal(error.vcxFunction, 'vcx_proof_send_request')
    assert.equal(error.message, 'Invalid Proof Handle')
  })

  it('get proof has an invalid proof state with incorrect proof', async () => {
    let connection = await Connection.create({ id: '234' })
    await connection.connect()
    const sourceId = 'SerializeDeserialize'
    const proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    let jsonProof = await proof.serialize()
    jsonProof.proof = JSON.parse(PROOF_MSG)
    jsonProof.state = StateType.Accepted
    jsonProof.proof_state = ProofState.Invalid
    jsonProof.handle = 8223
    const proof2 = await Proof.deserialize(jsonProof)
    await proof2.updateState()
    let proofData = await proof2.getProof(connection)
    assert.equal(proof2.proofState, ProofState.Invalid)
    assert.equal(proofData.proofState, 2)
  })

  const proofCreateCheckAndDelete = async () => {
    let connection = await Connection.create({ id: '234' })
    await connection.connect()
    const sourceId = 'SerializeDeserialize'
    let proof = await Proof.create({ sourceId, attrs: ATTR, name: 'TestProof' })
    let jsonProof = await proof.serialize()
    assert(jsonProof)
    const serialize = rustAPI().vcx_proof_serialize
    const handle = proof._handle
    connection = null
    proof = null
    return {
      handle,
      serialize
    }
  }

  // Fix the GC issue
  it('proof and GC deletes object should return null when serialize is called ', async function () {
    this.timeout(30000)

    const { handle, serialize } = await proofCreateCheckAndDelete()

    global.gc()

    let isComplete = false
    //  hold on to callbacks so it doesn't become garbage collected
    const callbacks = []

    while (!isComplete) {
      const data = await new Promise(function (resolve, reject) {
        const callback = ffi.Callback('void', ['uint32', 'uint32', 'string'],
            function (handle, err, data) {
              if (err) {
                reject(err)
                return
              }
              resolve(data)
            })
        callbacks.push(callback)
        const rc = serialize(
            0,
            handle,
            callback
        )

        if (rc === 1017) {
          resolve(null)
        }
      })
      if (!data) {
        isComplete = true
      }
    }

    // this will timeout if condition is never met
    // ill return "" because the proof object was released
    return isComplete
  })
})
