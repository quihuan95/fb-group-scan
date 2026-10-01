import fs from 'node:fs';import {google} from 'googleapis';import {env} from '../config/env.js';
const credentials=JSON.parse(fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_JSON,'utf8'));
const auth=new google.auth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/spreadsheets']});
export const sheets=google.sheets({version:'v4',auth});
export async function values(range:string){const r=await sheets.spreadsheets.values.get({spreadsheetId:env.SPREADSHEET_ID,range});return r.data.values||[]}
export async function update(range:string,rows:unknown[][]){await sheets.spreadsheets.values.update({spreadsheetId:env.SPREADSHEET_ID,range,valueInputOption:'USER_ENTERED',requestBody:{values:rows}})}
export async function append(range:string,rows:unknown[][]){await sheets.spreadsheets.values.append({spreadsheetId:env.SPREADSHEET_ID,range,valueInputOption:'USER_ENTERED',insertDataOption:'OVERWRITE',requestBody:{values:rows}})}
