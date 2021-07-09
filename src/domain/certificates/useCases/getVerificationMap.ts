import { NETWORKS, STEPS } from '../../../constants';
import chainsService from '../../chains';
import { getText } from '../../i18n/useCases';
import Versions, { isV3 } from '../../../constants/certificateVersions';
import { SUB_STEPS, substepsList, IVerificationSubstep } from '../../../constants/verificationSubSteps';
import { deepCopy } from '../../../helpers/object';
import { TVerificationStepsList, VerificationSteps } from '../../../constants/verificationSteps';
import { IBlockchainObject } from '../../../constants/blockchains';

export interface IVerificationMapItem {
  code: VerificationSteps;
  label: string;
  labelPending: string;
  subSteps: IVerificationSubstep[];
}

type TNetworkVerificationStepList = {
  [key in NETWORKS]: SUB_STEPS[];
};

export const versionVerificationMap: TNetworkVerificationStepList = {
  [NETWORKS.mainnet]: [
    SUB_STEPS.getTransactionId,
    SUB_STEPS.computeLocalHash,
    SUB_STEPS.fetchRemoteHash,
    SUB_STEPS.getIssuerProfile,
    SUB_STEPS.parseIssuerKeys,
    SUB_STEPS.compareHashes,
    SUB_STEPS.checkMerkleRoot,
    SUB_STEPS.checkReceipt,
    SUB_STEPS.checkRevokedStatus,
    SUB_STEPS.checkAuthenticity,
    SUB_STEPS.checkExpiresDate
  ],
  [NETWORKS.testnet]: [
    SUB_STEPS.computeLocalHash,
    SUB_STEPS.compareHashes,
    SUB_STEPS.checkReceipt,
    SUB_STEPS.checkExpiresDate
  ]
};

/**
 * stepsObjectToArray
 *
 * Turn an object with steps as properties to an array
 *
 * @param stepsObject
 * @returns {{code: string}[]}
 */
function stepsObjectToArray (stepsObject: TVerificationStepsList): IVerificationMapItem[] {
  return Object.keys(stepsObject).map(stepCode => {
    return {
      ...stepsObject[stepCode],
      code: stepCode,
      label: getText('steps', `${stepCode}Label`),
      labelPending: getText('steps', `${stepCode}LabelPending`)
    };
  });
}

/**
 * setSubStepsToSteps
 *
 * Takes an array of sub-steps and set them to their proper parent step
 *
 * @param subSteps
 * @returns {any}
 */
function setSubStepsToSteps (subSteps: IVerificationSubstep[]): TVerificationStepsList {
  const steps = deepCopy(STEPS.language);
  subSteps.forEach(subStep => steps[subStep.parentStep].subSteps.push(subStep));
  return steps;
}

/**
 * getFullStepsFromSubSteps
 *
 * Builds a full steps array (with subSteps property) from an array of sub-steps
 *
 * @param subStepMap
 * @returns {Array}
 */
function getFullStepsFromSubSteps (subStepMap: SUB_STEPS[]): IVerificationMapItem[] {
  const subSteps: IVerificationSubstep[] = subStepMap.map(stepCode => {
    const subStep = Object.assign({}, substepsList[stepCode]);
    return {
      ...subStep,
      label: getText('subSteps', `${stepCode}Label`),
      labelPending: getText('subSteps', `${stepCode}LabelPending`)
    };
  });

  const steps = setSubStepsToSteps(subSteps);

  return stepsObjectToArray(steps);
}

/**
 * getVerificationMap
 *
 * Get verification map from the chain
 *
 * @param chain
 * @returns {Array}
 */
export default function getVerificationMap (chain: IBlockchainObject, version: Versions): IVerificationMapItem[] {
  if (!chain) {
    return [];
  }

  const network = chainsService.isMockChain(chain) ? NETWORKS.testnet : NETWORKS.mainnet;
  const verificationMap = JSON.parse(JSON.stringify(versionVerificationMap));
  // TODO: handle this at map level
  if (isV3(version)) {
    const getIssuerProfileIndex = verificationMap[network].findIndex(subStep => subStep === SUB_STEPS.getIssuerProfile);
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete verificationMap[network][getIssuerProfileIndex];
  }
  return getFullStepsFromSubSteps(verificationMap[network]);
}
