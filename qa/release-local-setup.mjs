// Exercise the mounted control so React acknowledges the native setup result.
// Calling the setup bridge alone can leave an already mounted welcome open.
export async function completeLocalSetup(ui){
 const status=await ui.evaluate(()=>window.acira.setup({type:'status'})),skip=ui.getByRole('button',{name:'Skip setup',exact:true});
 if(!status.progress.complete||await skip.isVisible()){await skip.waitFor({state:'visible',timeout:10000});await skip.click();await ui.locator('.setup-dialog').waitFor({state:'detached',timeout:10000});}
 // The arrival consumes a press to skip itself; wait for genuine interactive readiness before a functional test's first click.
 await ui.waitForFunction(()=>!document.documentElement.hasAttribute('data-fr-finale')&&!document.querySelector('.fr-stage, .fr-finale-veil, .fr-finale-mark, .fr-ghost'),null,{timeout:20000});
}
