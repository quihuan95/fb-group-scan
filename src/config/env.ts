import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  SPREADSHEET_ID: z.string().default('1fjgnvvUHx9SZMpfC_lpsvJ4HWpcsrxDnxejIsY8rzPA'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default('./service-account.json'),
  DATA_DESTINATION_SPREADSHEET_ID: z.string().default('1v-QbJbwyp-v9XyJaAXS0k-3JvJSQAZXcAUvb-KkKK7M'),
  DATA_DESTINATION_SHEET: z.string().default('Tháng 10/26'),
  SCAN_WINDOW_HOURS: z.coerce.number().default(24),
  HEADLESS: z.string().default('false').transform(v => v === 'true'),
  MCP_PORT: z.coerce.number().default(8787),
  WRITE_LEADS: z.string().default('true').transform(v => v === 'true'),
  TEST_STT: z.string().optional()
});

export const env = schema.parse(process.env);

