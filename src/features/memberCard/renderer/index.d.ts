export interface CardPose{ry:number;rx:number;rz:number;env:number;flat:number}
export interface CardHandle{
 /** The drawing size in device pixels; the page sets the canvas' CSS size (the card sits in the middle 1/1.2 of the canvas: the rest is room for its shadow). */
 resize(width:number,height:number):void;
 draw(pose?:CardPose,options?:{margin?:number;shadow?:boolean}):void;
 /** The flat, front-on picture (transparent corners), at `width` px wide. */
 exportFlat(width?:number):Promise<Blob>;
 /** One slow tilt as a video (head-on at both ends) on the pack's stage grey, `seconds` long: an MP4 (H.264) where this browser can encode one, else a WebM. */
 recordTilt(options?:{seconds?:number;width?:number;fps?:number;onProgress?:(fraction:number)=>void}):Promise<Blob>;
 canvas:HTMLCanvasElement;
 dispose():void;
}
export const CARD_ASPECT:number;
export const REST_POSE:CardPose;
export function tiltPose(x:number,y:number):CardPose;
export function createMemberCard(canvas:HTMLCanvasElement,data:{rank:string;name:string;since:string;number:string},options?:{backdrop?:string|null;alpha?:boolean}):Promise<CardHandle>;
