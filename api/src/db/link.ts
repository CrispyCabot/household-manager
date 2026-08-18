import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { boardSk, emptyLinkDoc, householdPk } from '@hhm/shared';
import type { LinkDoc, LinkIcon } from '@hhm/shared';
import { docClient, tableName } from './client.js';

function linkSk(boardId: string): string {
  return `${boardSk(boardId)}#LINK`;
}

export async function loadLinkDoc(householdId: string, boardId: string): Promise<LinkDoc> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: linkSk(boardId) } }),
  );
  if (result.Item === undefined) return emptyLinkDoc();
  return {
    url: (result.Item.url as string | null | undefined) ?? null,
    icon: (result.Item.icon as LinkIcon | undefined) ?? emptyLinkDoc().icon,
  };
}

/** No `version`/optimistic-concurrency here — same last-write-wins trade-off as text docs (see db/text.ts). */
export async function saveLinkDoc(householdId: string, boardId: string, url: string, icon: LinkIcon): Promise<LinkDoc> {
  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: householdPk(householdId), SK: linkSk(boardId), url, icon },
    }),
  );
  return { url, icon };
}
