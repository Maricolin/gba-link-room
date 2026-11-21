// Normal development install first; keep the initial workstation cache usable.
try{module.exports=require('playwright-core');}
catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;module.exports=require('../../.tools/browser/node_modules/playwright-core');}
