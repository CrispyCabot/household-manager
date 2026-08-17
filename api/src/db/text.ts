import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { boardSk, emptyTextDoc, householdPk } from '@hhm/shared';
import type { TextBlock, TextDoc } from '@hhm/shared';
import { docClient, tableName } from './client.js';

function docSk(boardId: string): string {
  return `${boardSk(boardId)}#DOC`;
}

export async function loadTextDoc(householdId: string, boardId: string): Promise<TextDoc> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: docSk(boardId) } }),
  );
  if (result.Item === undefined) return emptyTextDoc();
  return {
    blocks: (result.Item.blocks as TextBlock[] | undefined) ?? emptyTextDoc().blocks,
    updatedBy: (result.Item.updatedBy as string | null | undefined) ?? null,
    updatedAt: (result.Item.updatedAt as string | null | undefined) ?? null,
  };
}

/** No `version`/optimistic-concurrency here — a single free-text document accepts last-write-wins, same trade-off the design doc makes for the non-goal of a permissions model. */
export async function saveTextDoc(
  householdId: string,
  boardId: string,
  blocks: TextBlock[],
  updatedBy: string,
): Promise<TextDoc> {
  const updatedAt = new Date().toISOString();
  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: householdPk(householdId), SK: docSk(boardId), blocks, updatedBy, updatedAt },
    }),
  );
  return { blocks, updatedBy, updatedAt };
}
