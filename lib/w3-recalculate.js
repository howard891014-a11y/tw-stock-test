'use strict';
// Deprecated in v2.6.8.22. Manual W3 recalculation is disabled until developer mode is ready.
// This module deliberately does not import Neon or modify snapshots.
module.exports = function disabledW3ManualRecalc(_req,res){
  res.setHeader('Cache-Control','no-store');
  return res.status(410).json({ok:false,error:'W3 手動重新運算已停用'});
};
