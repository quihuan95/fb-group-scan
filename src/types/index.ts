export type Service='Sự kiện'|'Thiết bị'|'Media'|'Thi công'|'Hội nghị MICE'|'Tiệc'|'Tour Inbound'|'Tour Outbound'|'Tour Nội địa'|'Xe'|'Vé';
export type Decision='NEW'|'UPDATE'|'DUPLICATE'|'HOLD'|'REJECT';
export interface GroupRow{row:number;stt:number;primary:Service;secondary:Service[];name:string;url:string;priority:'A'|'B'|'C';batch:number;status:string;keywords:string}
export interface ProductRule{service:Service;target:string;needs:string;main:string[];expanded:string[];excluded:string[];hotWarm:string;notes:string}
export interface RawPost{groupStt:number;groupName:string;canonicalGroupUrl:string;author:string;authorUrl?:string;postedLabel?:string;postedAt?:string;permalink?:string;text:string;ocrText?:string;contact?:string;images:string[]}
export interface Classification{buyerIntent:boolean;decision:Decision;services:Service[];temperature:'HOT'|'WARM'|'COLD'|'HOLD';needSummary:string;location?:string|null;eventDate?:string|null;scale?:string|null;contact?:string|null;exclusionReason:string|null;confidence:number;requiresHumanReview:boolean}
export interface Candidate extends RawPost{classification:Classification;canonicalKey:string;contactKey:string;needFingerprint:string}
