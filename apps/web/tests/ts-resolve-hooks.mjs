export async function resolve(specifier,context,next){
 try{return await next(specifier,context);}
 catch(error){if(/^\.{1,2}\//.test(specifier)&&!/\.[cm]?[jt]sx?$/.test(specifier))return next(specifier+'.ts',context);throw error;}
}
