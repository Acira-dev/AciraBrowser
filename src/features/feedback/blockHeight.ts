import {peekFeedbackView} from '../../runtime/feedback';

/** The height the contributor block adds at the top of the profile panel (ContributorBlock.tsx), so the panel's first frame opens at its final size: 0 while there is no contributor view (a
 * private window, a build that has not loaded it yet, a test), else its head, the line about the next rank, the notes waiting, the link rows and the divider. The measured pass corrects
 * any difference after the first frame. */
export function contributorBlockHeight():number{
 const view=peekFeedbackView();
 if(view.privateOrTor||view.key==='none')return 0;
 if(view.off)return view.reports.length?30+9:0;
 // Measured in the app: the first note line wraps to two at 320 px, so it counts as two; a name question adds 100.
 const note=(lines:number,ask:boolean)=>20+(lines+1)*17+(ask?100:0)+10;
 const notes=view.notes.reduce((sum,item)=>sum+note(1+(item.points?1:0)+(item.rank?1:0),item.askName),0);
 // The first rank's line ("Your first accepted report makes you a Contributor.") wraps to two lines at 320 px: 16 more than a one-line figure.
 return 6+24+(view.next&&view.available?4+16+(view.next.away===null?16:0):0)+(view.rank&&view.mark?18:0)+8+notes+30+30+9;
}
