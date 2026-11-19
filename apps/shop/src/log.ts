export type LogLine = Record<string, unknown>;
export type Logger = (line: LogLine) => void;

/** JSON lines on stdout: visible in `gddy hosting log list`, no dependency. */
export const stdoutLogger: Logger = (line) => {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`);
};

const PHONE_VISIBLE_DIGITS = 4;
const PHONE_MASK = "******";

/** 04 §6: phone numbers are masked in logs (`******1234`). */
export const maskPhone = (phone: string): string =>
  `${PHONE_MASK}${phone.slice(-PHONE_VISIBLE_DIGITS)}`;
