import { Workflow } from '../projects/schemas/workflow.schema';

/**
 * Legal status transitions are now a property of a project's workflow (custom, or the system
 * default - see workflow.schema.ts's DEFAULT_WORKFLOW/resolveWorkflow), not a fixed enum. Callers
 * resolve the workflow first (ProjectsService/resolveWorkflow) and pass it in here.
 */
export function legalTaskTransitions(workflow: Workflow, current: string): string[] {
  return workflow.transitions.filter((t) => t.from === current).map((t) => t.to);
}

export function isLegalTaskTransition(workflow: Workflow, from: string, to: string): boolean {
  return legalTaskTransitions(workflow, from).includes(to);
}
