import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { householdPk } from '@hhm/shared';
import type { TaskAuditAction, TaskAuditChange, TaskAuditEntry } from '@hhm/shared';
import { docClient, tableName } from './client.js';
import { queryAllPages, taskSk } from './tasks.js';

function auditSk(boardId: string, taskId: string, at: string, id: string): string {
  return `${taskSk(boardId, taskId)}#AUDIT#${at}#${id}`;
}

export interface TaskAuditInput {
  actor: string;
  action: TaskAuditAction;
  hours?: number;
  changes?: TaskAuditChange[];
}

/**
 * Append-only history of what was done to a task and by whom. Its SK has
 * 6 '#'-delimited segments (like completion records), so the board's task
 * listing and the alert query — which only take 4-segment task items — never
 * see it. Best-effort: a failed audit write is logged, never allowed to fail
 * the action it describes.
 */
export async function recordTaskAudit(householdId: string, boardId: string, taskId: string, input: TaskAuditInput): Promise<void> {
  const at = new Date().toISOString();
  const suffix = crypto.randomUUID().slice(0, 8);
  try {
    await docClient().send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: householdPk(householdId),
          SK: auditSk(boardId, taskId, at, suffix),
          id: `${at}#${suffix}`,
          taskId,
          at,
          actor: input.actor,
          action: input.action,
          hours: input.hours ?? null,
          changes: input.changes ?? [],
        },
      }),
    );
  } catch (err) {
    console.error(`task audit write failed for task ${taskId}`, err);
  }
}

/** Newest first. */
export async function listTaskAudit(householdId: string, boardId: string, taskId: string): Promise<TaskAuditEntry[]> {
  const items = await queryAllPages({
    TableName: tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': `${taskSk(boardId, taskId)}#AUDIT#` },
    ScanIndexForward: false,
  });
  return items.map((i) => ({
    id: String(i.id),
    taskId: String(i.taskId),
    at: String(i.at),
    actor: String(i.actor),
    action: i.action as TaskAuditEntry['action'],
    hours: (i.hours as number | null | undefined) ?? null,
    changes: (i.changes as TaskAuditChange[] | undefined) ?? [],
  }));
}
