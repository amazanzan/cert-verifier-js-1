import { Decoder } from '@vaultie/lds-merkle-proof-2019';
import { LDMerkleProof2019 } from 'jsonld-signatures-merkleproof2019';
import * as inspectors from '../inspectors';
import domain from '../domain';
import { Suite } from '../models/Suite';
import { isDidUri } from '../domain/verifier/useCases/getIssuerProfile';
import { getVCProofVerificationMethod } from '../models/BlockcertsV3';
import type { ExplorerAPI, TransactionData } from '@blockcerts/explorer-lookup';
import type { IDidDocumentPublicKey } from '@decentralized-identity/did-common-typescript';
import type { IBlockchainObject } from '../constants/blockchains';
import type { Receipt } from '../models/Receipt';
import type { Issuer, IssuerPublicKeyList } from '../models/Issuer';
import type { BlockcertsV3, VCProof } from '../models/BlockcertsV3';
import type VerificationSubstep from '../domain/verifier/valueObjects/VerificationSubstep';
import type { SuiteAPI } from '../models/Suite';
import type { ITransactionLink } from '../domain/certificates/useCases/getTransactionLink';
import type { IDidDocument } from '../models/DidDocument';

enum SUB_STEPS {
  getTransactionId = 'getTransactionId',
  computeLocalHash = 'computeLocalHash',
  fetchRemoteHash = 'fetchRemoteHash',
  parseIssuerKeys = 'parseIssuerKeys',
  compareHashes = 'compareHashes',
  checkImagesIntegrity = 'checkImagesIntegrity',
  checkMerkleRoot = 'checkMerkleRoot',
  checkReceipt = 'checkReceipt',
  retrieveVerificationMethodPublicKey = 'retrieveVerificationMethodPublicKey',
  deriveIssuingAddressFromPublicKey = 'deriveIssuingAddressFromPublicKey',
  compareIssuingAddress = 'compareIssuingAddress',
  checkAuthenticity = 'checkAuthenticity'
}

export function parseReceipt (proof: VCProof): Receipt {
  const base58Decoder = new Decoder(proof.proofValue);
  return base58Decoder.decode();
}

export default class MerkleProof2019 extends Suite {
  public proofVerificationProcess = [
    SUB_STEPS.parseIssuerKeys,
    SUB_STEPS.checkAuthenticity
  ]; // find a way to expose verification steps without executing process from here

  public identityVerificationProcess = [
    SUB_STEPS.retrieveVerificationMethodPublicKey,
    SUB_STEPS.deriveIssuingAddressFromPublicKey,
    SUB_STEPS.compareIssuingAddress
  ];

  public transactionId: string;
  public localHash: string;
  public documentToVerify: BlockcertsV3;
  public txData: TransactionData;
  public chain: IBlockchainObject;
  public explorerAPIs: ExplorerAPI[];
  public receipt: Receipt;
  public issuerPublicKeyList: IssuerPublicKeyList;
  public issuer: Issuer;
  public verificationMethodPublicKey: IDidDocumentPublicKey;
  public derivedIssuingAddress: string;
  public hasDid: boolean;
  public proof: VCProof;
  public type = 'MerkleProof2019';
  public suite: LDMerkleProof2019;

  constructor (props: SuiteAPI) {
    super(props);
    this.executeStep = props.executeStep;
    this.documentToVerify = props.document as BlockcertsV3;
    this.explorerAPIs = props.explorerAPIs;
    this.proof = props.proof as VCProof;
    this.issuer = props.issuer;
    this.validateProofType();
    this.receipt = parseReceipt(this.proof);
    this.chain = domain.certificates.getChain('', this.receipt);
    this.transactionId = domain.certificates.getTransactionId(this.receipt);
    this.setHasDid();
    this.suite = new LDMerkleProof2019({
      document: this.documentToVerify,
      proof: this.proof,
      options: {
        explorerAPIs: this.explorerAPIs,
        executeStepMethod: this.executeStep
      }
    });
  }

  async verifyProof (): Promise<void> {
    await this.setIssuerFromProofVerificationMethod();
    await this.suite.verifyProof();
    await this.verifyProcess(this.proofVerificationProcess);
  }

  async verifyIdentity (): Promise<void> {
    if (this.hasDid) {
      await this.verifyProcess(this.identityVerificationProcess);
    }
  }

  getProofVerificationSteps (parentStepKey: string): VerificationSubstep[] {
    const proofVerificationProcess = [
      ...this.suite.getProofVerificationProcess(),
      ...this.proofVerificationProcess
    ];
    return proofVerificationProcess.map(childStepKey =>
      domain.verifier.convertToVerificationSubsteps(parentStepKey, childStepKey)
    );
  }

  getIdentityVerificationSteps (parentStepKey: string): VerificationSubstep[] {
    if (!this.hasDid) {
      return [];
    }
    return this.identityVerificationProcess.map(childStepKey =>
      domain.verifier.convertToVerificationSubsteps(parentStepKey, childStepKey)
    );
  }

  getIssuerPublicKey (): string {
    return this.suite.getIssuerPublicKey();
  }

  getIssuanceTime (): string {
    return this.suite.getIssuanceTime();
  }

  getIssuerName (): string {
    return this.issuer.name;
  }

  getIssuerProfileDomain (): string {
    const issuerProfileUrl = new URL(this.getIssuerProfileUrl());
    return issuerProfileUrl?.hostname;
  }

  getIssuerProfileUrl (): string {
    return this.issuer.id;
  }

  getSigningDate (): string {
    return this.proof.created;
  }

  getChain (): IBlockchainObject {
    return this.chain;
  }

  getReceipt (): Receipt {
    return this.receipt;
  }

  // TODO: rename inspector method to make this function `getTransactionId`
  getTransactionIdString (): string {
    return domain.certificates.getTransactionId(this.getReceipt());
  }

  getTransactionLink (): string {
    const transactionLinks: ITransactionLink = domain.certificates.getTransactionLink(this.getTransactionIdString(), this.getChain());
    return transactionLinks.transactionLink;
  }

  getRawTransactionLink (): string {
    const transactionLinks: ITransactionLink = domain.certificates.getTransactionLink(this.getTransactionIdString(), this.getChain());
    return transactionLinks.rawTransactionLink;
  }

  async executeStep (step: string, action, verificationSuite: string): Promise<any> {
    throw new Error('executeStep method needs to be overwritten by injecting from Verifier');
  }

  private getTargetVerificationMethodContainer (): Issuer | IDidDocument {
    return this.issuer.didDocument ?? this.issuer;
  }

  private isProofChain (): boolean {
    return this.proof.type === 'ChainedProof2021';
  }

  private async setIssuerFromProofVerificationMethod (): Promise<void> {
    if (this.isProofChain()) {
      const issuerProfileUrl = this.proof.verificationMethod.split('#')[0];
      this.issuer = await domain.verifier.getIssuerProfile(issuerProfileUrl);
    }
  }

  private setHasDid (): void {
    if (this.isProofChain()) {
      const issuerProfileUrl = this.proof.verificationMethod.split('#')[0];
      this.hasDid = isDidUri(issuerProfileUrl);
      return;
    }
    this.hasDid = !!this.issuer.didDocument;
  }

  private validateProofType (): void {
    const proofType = this.isProofChain() ? this.proof.chainedProofType : this.proof.type;
    if (proofType !== this.type) {
      throw new Error(`Incompatible proof type passed. Expected: ${this.type}, Got: ${proofType}`);
    }
  }

  private async verifyProcess (process: SUB_STEPS[]): Promise<void> {
    for (const verificationStep of process) {
      if (!this[verificationStep]) {
        console.error('verification logic for', verificationStep, 'not implemented');
        return;
      }
      await this[verificationStep]();
    }
  }

  private async parseIssuerKeys (): Promise<void> {
    this.issuerPublicKeyList = await this.executeStep(
      SUB_STEPS.parseIssuerKeys,
      () => domain.verifier.parseIssuerKeys(this.issuer),
      this.type
    );
  }

  private async checkAuthenticity (): Promise<void> {
    await this.executeStep(
      SUB_STEPS.checkAuthenticity,
      () => inspectors.ensureValidIssuingKey(this.issuerPublicKeyList, this.getIssuerPublicKey(), this.getIssuanceTime()),
      this.type
    );
  }

  // ##### DID CORRELATION #####
  private async retrieveVerificationMethodPublicKey (): Promise<void> {
    this.verificationMethodPublicKey = await this.executeStep(
      SUB_STEPS.retrieveVerificationMethodPublicKey,
      () => inspectors
        .retrieveVerificationMethodPublicKey(
          this.issuer.didDocument,
          getVCProofVerificationMethod(this.proof)
        ),
      this.type
    );
  }

  private async deriveIssuingAddressFromPublicKey (): Promise<void> {
    this.derivedIssuingAddress = await this.executeStep(
      SUB_STEPS.deriveIssuingAddressFromPublicKey,
      () => inspectors.deriveIssuingAddressFromPublicKey(this.verificationMethodPublicKey, this.chain),
      this.type
    );
  }

  private async compareIssuingAddress (): Promise<void> {
    await this.executeStep(
      SUB_STEPS.compareIssuingAddress,
      () => inspectors.compareIssuingAddress(this.getIssuerPublicKey(), this.derivedIssuingAddress),
      this.type
    );
  }
}
