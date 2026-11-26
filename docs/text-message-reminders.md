# Text message reminders (not built)

Task reminders can go out by email and Android app notification. Texting them
to a phone was built once and then rolled back, because sending texts from AWS
needs account setup that hasn't been done. This page is what it takes to bring
it back.

## Bringing the code back

The full feature is commit `eede984` ("Add text message reminders"), kept on
the `feat/text-message-reminders` branch and in PR #21. Its revert is in
`main`, so either revert that revert or cherry-pick `eede984` onto a new
branch, then run the checks in `CLAUDE.md`.

What it adds:

- **Profile page:** under Task reminders, a person adds a US or Canadian
  number, confirms it with a six digit texted code, and can change the number
  or stop texts. Texts go out on top of whatever "Send reminders by" is set to.
- **API:** `PUT /v1/me/text-phone` (texts a code), `POST /v1/me/text-phone/verify`,
  `DELETE /v1/me/text-phone/pending` and `DELETE /v1/me/text-phone`. Codes are
  hashed, expire after 10 minutes, allow five tries and one resend per 30
  seconds. The verified number is `textPhone` on the profile item.
- **Reminders:** `api/src/reminder.ts` texts the same title, body and task link
  as the push notification.
- **Sending:** `api/src/sms.ts` uses AWS End User Messaging SMS
  (`@aws-sdk/client-pinpoint-sms-voice-v2`). Both Lambdas get
  `sms-voice:SendTextMessage`, and the deploy passes the optional
  `SMS_ORIGINATION_IDENTITY` repo variable through to them.

## AWS setup

Texts can't go out until all of this is done in the stack's AWS account and
region:

1. In the End User Messaging SMS console, **Phone numbers → Request
   originator**: United States, toll-free, SMS, transactional. About $2 a month
   plus a per-text fee.
2. Submit the toll-free registration it asks for. The number can't text US
   phones until AWS approves it, which can take days to weeks.
3. New accounts are in the SMS sandbox. Either add each person's number under
   **Sandbox → Verified destination numbers**, or request production access.
   Raise the account's monthly SMS spend limit too, which starts very low.
4. Add the number's ARN as the `SMS_ORIGINATION_IDENTITY` repo variable
   (Settings → Secrets and variables → Actions → Variables) and deploy.

Until then, asking for a code shows "Couldn't send a text to that number" and
nothing else changes.
