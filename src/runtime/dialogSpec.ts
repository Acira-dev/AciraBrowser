/** Beta 14: what a question to the person looks like when it travels from main (desktop/site-prompt.cjs `describe`, plus the icons it looks up) to the interface and the overlay that draws it as frosted glass. */
export type DialogButton={index:number;label:string;role:'primary'|'danger'|'secondary'};
export type DialogIcon={host:string;favicon:string;glyph?:unknown[]};
export type DialogIcons={items:DialogIcon[];more:number;moreLabel:string}|null;
export interface DialogSpec{
  /** One question: main answers it by this number. */
  token:number;
  mode:'centered'|'anchored';
  host:string;message:string;detail:string;favicon:string;
  /** 'close' is the Close Acira? / unsaved-work card (the app's mark, the sites' icons or rows, the checkbox). */
  variant:''|'close';
  top?:boolean;caption:string;body:string;strip:DialogIcons;list:DialogIcons;
  buttons:DialogButton[];cancelIndex:number;defaultIndex:number;
  /** A badge on the site's icon (camera, mic, pin, bell) or an accent tile with its own glyph (external, key, refresh), for a prompt. */
  badge?:string;icon?:string;
  /** The one quiet line of a prompt (the sample's copy), in place of the longer detail the system dialog shows. */
  quiet?:string;
  /** A page's own alert, confirm or prompt: "{host} says" above its message, the site's icon. */
  says?:boolean;
  /** 'danger': a destructive confirm (delete, clear): a red tile and a flat red button for the destructive answer, whichever answer is the default. */
  tone?:'danger'|'';
  input:{value:string}|null;mute:{label:string}|null;manage:{label:string}|null;note:string;closeLabel:string;
  /** The app's mark for the close card (a data URL main reads once). */
  appIcon?:string;
  /** Beta 14 (toolbar prompts): which prompt this is, so the card draws the sample's layout for it: a site's permission (the default), "Open an app?", "Save / Update password?". */
  prompt?:'perm'|'extapp'|'savepw';
  /** Where an anchored prompt hangs: under the site-identity icon (a permission, open an app; the default) or at the right end of the address field (save password), as in the sample. */
  place?:'identity'|'field';
  /** Save / update password: what is being offered. The password itself stays in main (`reveal` is the eye: main sends it once, on a press). */
  save?:{username:string;masked:string;noUsername:string;usernameLabel:string;passwordLabel:string;reveal:boolean;showLabel:string;hideLabel:string};
  /** A sign-in card (HTTP authentication): labelled fields, and the notes above them (an unencrypted connection, a refused password). */
  fields?:DialogField[];warns?:string[];
}
export type DialogField={name:'username'|'password';label:string;value:string;secret:boolean};
export type DialogAnswer={id:number;index:number;dismissed?:boolean;/** The typed text of a prompt. */text?:string;/** The checkbox ("Don't ask again"). */muted?:boolean;/** A sign-in card's fields. */values?:{username?:string;password?:string}};
