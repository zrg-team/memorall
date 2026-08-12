var c=(r=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(r,{get:(e,o)=>(typeof require<"u"?require:e)[o]}):r)(function(r){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+r+'" is not supported')});var _=(r,e)=>()=>(e||r((e={exports:{}}).exports,e),e.exports);var l=_(n=>{"use strict";var y=c("/sandbox/vendors/react.mjs"),d=Symbol.for("react.element"),m=Symbol.for("react.fragment"),O=Object.prototype.hasOwnProperty,v=y.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,E={key:!0,ref:!0,__self:!0,__source:!0};function i(r,e,o){var t,s={},f=null,u=null;o!==void 0&&(f=""+o),e.key!==void 0&&(f=""+e.key),e.ref!==void 0&&(u=e.ref);for(t in e)O.call(e,t)&&!E.hasOwnProperty(t)&&(s[t]=e[t]);if(r&&r.defaultProps)for(t in e=r.defaultProps,e)s[t]===void 0&&(s[t]=e[t]);return{$$typeof:d,type:r,key:f,ref:u,props:s,_owner:v.current}}n.Fragment=m;n.jsx=i;n.jsxs=i});var j=_((N,p)=>{p.exports=l()});export default j();
/*! Bundled license information:

react-sandbox/cjs/react-jsx-runtime.production.min.js:
  (**
   * @license React
   * react-jsx-runtime.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
