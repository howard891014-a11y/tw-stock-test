'use strict';
/**
 * W3-D.1.2 uses the SAME coverage-gated Neon/native daily source adapter as
 * W3-D.1.1, without changing the source's original calculation or naming.
 * The version change is in the immutable frozen formula, NOT the input rows.
 * Historical alias is retained for old shadow regression comparisons.
 */
const {fetchW3D111Inputs}=require('./w3-d111-inputs');
module.exports={fetchW3D112Inputs:fetchW3D111Inputs};
