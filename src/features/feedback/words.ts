import {t,type MessageId} from '../../i18n';
import type {FailureKind,FeedbackNote,FeedbackReport,Rank,ReportCategory} from '../../runtime/feedback';

/* The words of section E, in one place. Calm and plain; the word "rewards" is never used. */
const rankIds:Record<Rank,MessageId>={contributor:'feedback.rank.contributor',trusted:'feedback.rank.trusted',insider:'feedback.rank.insider',founding:'feedback.rank.founding'};
export const rankName=(rank:Rank)=>t(rankIds[rank]);
export const markName=()=>t('feedback.mark.earlyMember');
export const pointsLabel=(count:number)=>t('feedback.points',{count});
/** "19 points away from Trusted Contributor", or the first rank's own line, or nothing (null). */
export const awayLine=(next:{rank:Rank;away:number|null}|null)=>!next?null:next.away===null?t('feedback.away.first'):t('feedback.away',{count:next.away,rank:rankName(next.rank)});
const categoryIds:Record<ReportCategory,MessageId>={broken:'feedback.kind.broken',looks:'feedback.kind.looks',crash:'feedback.kind.crash',site:'feedback.kind.site'};
export const categoryName=(category:ReportCategory)=>t(categoryIds[category]);

const noteRankIds:Record<Rank,MessageId>={contributor:'feedback.note.rank.contributor',trusted:'feedback.note.rank.trusted',insider:'feedback.note.rank.insider',founding:'feedback.note.rank.founding'};
/** The lines of one note, in order: what the server said happened, in the person's language. */
export function noteLines(note:FeedbackNote,reports:FeedbackReport[]):string[]{
 if(note.kind==='shipped'){
  const kind=reports.find(item=>item.id===note.reportId)?.kind;
  return [t(kind==='idea'?'feedback.note.shippedIdea':'feedback.note.shippedBug',{release:note.release??''})];
 }
 if(note.kind==='invited')return [t('feedback.note.invited'),...(note.points?[t('feedback.note.points',{count:note.points})]:[])];
 const lines=[t('feedback.note.accepted')];
 if(note.points)lines.push(t('feedback.note.points',{count:note.points}));
 if(note.rank)lines.push(t(noteRankIds[note.rank]));
 return lines;
}
/** "We're working on it", "Fixed in beta.14" for a report in Your reports. Never a plan or a date. */
export const statusLine=(report:FeedbackReport)=>report.status==='fixed'?(report.release?t(report.kind==='idea'?'feedback.status.shippedIdea':'feedback.status.fixedIn',{release:report.release}):t('feedback.status.fixed')):t(report.status==='working'?'feedback.status.working':'feedback.status.received');
/** Why a send did not go, in words. 'later' covers the server answering and refusing (limits, its storage); the connection is not blamed then. */
export const failureText=(failure?:FailureKind)=>t(failure==='later'?'feedback.tryLater':failure==='clock'?'feedback.clock':failure==='unavailable'?'feedback.unavailable':failure==='private'?'feedback.private':failure==='nokey'?'feedback.settings.unreadable':'feedback.failed');
const attachIds:Record<string,MessageId>={type:'feedback.attach.problem.type',size:'feedback.attach.problem.size',length:'feedback.attach.problem.length','unknown-length':'feedback.attach.problem.unknownLength',count:'feedback.attach.problem.count',unreadable:'feedback.attach.problem.unreadable',empty:'feedback.attach.problem.type'};
export const attachProblem=(reason?:string)=>t(attachIds[reason||'']??'feedback.attach.problem.type');
