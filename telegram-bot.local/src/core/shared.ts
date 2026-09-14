export { parseAndMigrateFunnelDocument } from '../../../src/model/schema'
export { calculateTestResult } from '../../../src/model/scoring'
export { emptyAnalytics, nodeHandles, nodeTitle } from '../../../src/model/funnel'
export { nextNodeId } from '../../../src/model/simulator'
export { validateFunnel } from '../../../src/model/validation'
export {
  applyVariableOperations,
  evaluateCondition,
  initialVariableValues,
  renderVariableTemplate,
} from '../../../src/model/variables'
export type {
  CalculatedTestResult,
  CombinedTestResult,
  ConsentData,
  ConditionData,
  EndData,
  ExternalLinkData,
  FormData,
  FormField,
  FunnelDocument,
  FunnelEdge,
  FunnelNode,
  FunnelTest,
  MediaAsset,
  MediaData,
  MediaType,
  MessageButton,
  MessageData,
  Product,
  ProductBlockData,
  QuestionType,
  ResultButton,
  TestAnswer,
  TestBlockData,
  TestQuestion,
  TestResult,
  TimerData,
  ValidationIssue,
  VariableData,
  VariableValue,
} from '../../../src/model/types'
