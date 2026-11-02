/** Display names can stay simple while the updater compares the full build version. */
export function releaseVersion(version:string){
 const beta=/^(\d+)\.(\d+)\.(\d+)-beta\.\d+$/.exec(version);
 // i18n-ignore: "Beta" is part of the version's name, as the release is named
 return beta?`${beta[1]}.${beta[2]}${beta[3]==='0'?'':'.'+beta[3]} Beta`:version;
}
