import type { PinpointSMSVoiceV2Client } from '@aws-sdk/client-pinpoint-sms-voice-v2';

let client: PinpointSMSVoiceV2Client | undefined;

/** Loaded on first send, so a problem with the SMS client can't break the rest of the API. */
export async function sendText(to: string, body: string): Promise<void> {
  const sdk = await import('@aws-sdk/client-pinpoint-sms-voice-v2');
  client ??= new sdk.PinpointSMSVoiceV2Client({});
  const origination = process.env.SMS_ORIGINATION_IDENTITY;
  await client.send(
    new sdk.SendTextMessageCommand({
      DestinationPhoneNumber: to,
      MessageBody: body,
      MessageType: 'TRANSACTIONAL',
      ...(origination === undefined || origination === '' ? {} : { OriginationIdentity: origination }),
    }),
  );
}
