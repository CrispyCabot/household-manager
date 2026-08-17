import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { boardSk, householdPk } from '@hhm/shared';
import type { ChecklistItem, CreateChecklistItemInput, UpdateChecklistItemInput } from '@hhm/shared';
import { docClient, tableName } from './client.js';

export class ChecklistItemNotFoundError extends Error {
  constructor() {
    super('Checklist item not found');
    this.name = 'ChecklistItemNotFoundError';
  }
}

function itemSk(boardId: string, itemId: string): string {
  return `${boardSk(boardId)}#ITEM#${itemId}`;
}

function fromItem(i: Record<string, unknown>): ChecklistItem {
  return {
    id: String(i.id),
    householdId: String(i.householdId),
    boardId: String(i.boardId),
    text: String(i.text),
    checked: Boolean(i.checked),
    position: Number(i.position),
    checkedAt: (i.checkedAt as string | null | undefined) ?? null,
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
  };
}

export async function listChecklistItems(householdId: string, boardId: string): Promise<ChecklistItem[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': `${boardSk(boardId)}#ITEM#` },
    }),
  );
  const items = (result.Items ?? []).map(fromItem);
  // Unchecked items keep their manual order; checked items sink to the
  // bottom, oldest-checked first, so ticking one off visibly moves it away.
  return items.sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    if (a.checked) return (a.checkedAt ?? '').localeCompare(b.checkedAt ?? '');
    return a.position - b.position;
  });
}

export async function createChecklistItem(input: {
  householdId: string;
  boardId: string;
  createdBy: string;
  item: CreateChecklistItemInput;
}): Promise<ChecklistItem> {
  const now = new Date().toISOString();
  const existing = await listChecklistItems(input.householdId, input.boardId);

  const item: ChecklistItem = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    boardId: input.boardId,
    text: input.item.text,
    checked: false,
    position: existing.length,
    checkedAt: null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: householdPk(input.householdId), SK: itemSk(input.boardId, item.id), ...item },
    }),
  );

  return item;
}

async function updateItem(
  householdId: string,
  boardId: string,
  itemId: string,
  update: Record<string, unknown>,
): Promise<ChecklistItem> {
  const now = new Date().toISOString();
  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: itemSk(boardId, itemId) },
        UpdateExpression:
          'SET ' + Object.keys(update).map((k) => `#${k} = :${k}`).join(', ') + ', updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: Object.fromEntries(Object.keys(update).map((k) => [`#${k}`, k])),
        ExpressionAttributeValues: {
          ...Object.fromEntries(Object.entries(update).map(([k, v]) => [`:${k}`, v])),
          ':updatedAt': now,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return fromItem(result.Attributes ?? {});
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      throw new ChecklistItemNotFoundError();
    }
    throw err;
  }
}

export async function renameChecklistItem(
  householdId: string,
  boardId: string,
  itemId: string,
  input: UpdateChecklistItemInput,
): Promise<ChecklistItem> {
  return updateItem(householdId, boardId, itemId, { text: input.text });
}

export async function toggleChecklistItem(householdId: string, boardId: string, itemId: string): Promise<ChecklistItem> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: itemSk(boardId, itemId) } }),
  );
  if (result.Item === undefined) throw new ChecklistItemNotFoundError();
  const current = fromItem(result.Item);
  const checked = !current.checked;
  return updateItem(householdId, boardId, itemId, { checked, checkedAt: checked ? new Date().toISOString() : null });
}

export async function deleteChecklistItem(householdId: string, boardId: string, itemId: string): Promise<boolean> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: itemSk(boardId, itemId) } }),
  );
  if (result.Item === undefined) return false;
  await docClient().send(
    new DeleteCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: itemSk(boardId, itemId) } }),
  );
  return true;
}
