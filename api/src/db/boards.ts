import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { boardSk, boardType, householdPk } from '@hhm/shared';
import type { Board } from '@hhm/shared';
import { ApiError } from '../errors.js';
import { docClient, tableName } from './client.js';

function fromItem(i: Record<string, unknown>): Board {
  return {
    id: String(i.id),
    householdId: String(i.householdId),
    type: String(i.type),
    title: String(i.title),
    position: Number(i.position),
    // Boards created before this field existed have none stored — `{}` is
    // exactly what an untouched config should read as, so no migration.
    config: (i.config as Record<string, unknown> | undefined) ?? {},
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
  };
}

export async function createBoard(input: { householdId: string; type: string; title: string }): Promise<Board> {
  // The registry is the single source of truth for what a board can be.
  // Rejecting an unknown type here is what stops a client from creating a
  // board no UI or route can ever render. In phase 1 the registry is empty,
  // so every create fails until phase 2 registers "tasks" — that is expected.
  if (boardType(input.type) === undefined) {
    throw new ApiError(400, 'unknown_board_type', `No board type "${input.type}" is registered`);
  }

  const now = new Date().toISOString();
  const existing = await listBoards(input.householdId);
  const board: Board = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    type: input.type,
    title: input.title,
    position: existing.length,
    config: {},
    createdAt: now,
    updatedAt: now,
  };

  await docClient().send(
    new PutCommand({ TableName: tableName(), Item: { PK: householdPk(input.householdId), SK: boardSk(board.id), ...board } }),
  );

  return board;
}

export async function listBoards(householdId: string): Promise<Board[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'BOARD#' },
    }),
  );
  // A board's own item has SK "BOARD#<id>" — exactly one '#'. Items a board
  // type stores beneath it (e.g. phase 2's "BOARD#<id>#TASK#<id>") share the
  // prefix but have more, so they are filtered out here.
  return (result.Items ?? [])
    .filter((i) => String(i.SK).split('#').length === 2)
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map(fromItem);
}

export async function loadBoard(householdId: string, boardId: string): Promise<Board | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: boardSk(boardId) } }),
  );
  return result.Item === undefined ? null : fromItem(result.Item);
}

export async function renameBoard(householdId: string, boardId: string, title: string): Promise<Board | null> {
  const existing = await loadBoard(householdId, boardId);
  if (existing === null) return null;

  const result = await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: boardSk(boardId) },
      UpdateExpression: 'SET title = :title, updatedAt = :now',
      ExpressionAttributeValues: { ':title': title, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return fromItem(result.Attributes ?? {});
}

export async function updateBoardConfig(householdId: string, boardId: string, config: Record<string, unknown>): Promise<Board | null> {
  const existing = await loadBoard(householdId, boardId);
  if (existing === null) return null;

  const result = await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: boardSk(boardId) },
      UpdateExpression: 'SET config = :config, updatedAt = :now',
      ExpressionAttributeValues: { ':config': config, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return fromItem(result.Attributes ?? {});
}

/** Raised when boardIds isn't exactly the household's current board set, each once. */
export class InvalidOrderError extends Error {}

export async function reorderBoards(householdId: string, boardIds: string[]): Promise<Board[]> {
  const existing = await listBoards(householdId);
  const existingIds = new Set(existing.map((b) => b.id));
  if (
    boardIds.length !== existing.length ||
    new Set(boardIds).size !== boardIds.length ||
    boardIds.some((id) => !existingIds.has(id))
  ) {
    throw new InvalidOrderError("boardIds must be exactly the household's current boards, each once");
  }

  const now = new Date().toISOString();
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: boardIds.map((id, position) => ({
        Update: {
          TableName: tableName(),
          Key: { PK: householdPk(householdId), SK: boardSk(id) },
          UpdateExpression: 'SET #position = :pos, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#position': 'position' },
          ExpressionAttributeValues: { ':pos': position, ':now': now },
        },
      })),
    }),
  );

  const byId = new Map(existing.map((b) => [b.id, b]));
  return boardIds.map((id, position) => ({ ...byId.get(id)!, position, updatedAt: now }));
}

export async function deleteBoard(householdId: string, boardId: string): Promise<boolean> {
  const existing = await loadBoard(householdId, boardId);
  if (existing === null) return false;

  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': boardSk(boardId) },
    }),
  );

  // Deletes the board item and everything a board type stored beneath it —
  // a board type never has to clean up after itself when its board is
  // removed (spec §5).
  await Promise.all(
    (result.Items ?? []).map((item) =>
      docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
  return true;
}
