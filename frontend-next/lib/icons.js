/**
 * Solid 24×24 icon set — a straight port of public/js/icons.js from the old app,
 * so both apps draw the same shapes.
 *
 * Every path uses fill="currentColor", so an icon takes the colour of whatever
 * text it sits in: white on a dark button, teal in the sidebar, black in print.
 * No dependency and nothing fetched — the shop's machines may be offline.
 */

export const SHAPES = {
  home: '<path d="M12 3.1 2.6 10.9l1.3 1.5.6-.5V20a1.5 1.5 0 0 0 1.5 1.5h4V15h4v6.5h4A1.5 1.5 0 0 0 19.5 20v-8.1l.6.5 1.3-1.5z"/>',

  board: '<rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="11" rx="1.2"/><rect x="16" y="4" width="5" height="14" rx="1.2"/>',

  glasses: '<path fill-rule="evenodd" d="M6.4 10.5a4.6 4.6 0 1 0 4.5 5.4h2.2a4.6 4.6 0 1 0 .3-2H10.6a4.6 4.6 0 0 0-4.2-3.4zm0 2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zm11.2 0a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z"/><path d="M4.3 11.6 2.4 11 4 6.2l1.9.6zm15.4 0 1.9-.6L19.9 6.2l-1.9.6z"/>',

  eye: '<path fill-rule="evenodd" d="M12 4.8c-4.6 0-8.5 2.9-10.4 7.2 1.9 4.3 5.8 7.2 10.4 7.2s8.5-2.9 10.4-7.2C20.5 7.7 16.6 4.8 12 4.8zm0 2.4a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zm0 2.2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z"/>',

  calendar: '<path d="M8 2v2h8V2h2v2h.5A2.5 2.5 0 0 1 21 6.5V9H3V6.5A2.5 2.5 0 0 1 5.5 4H6V2z"/><path fill-rule="evenodd" d="M3 11h18v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5zm4 2H5v2h2zm4 0H9v2h2zm4 0h-2v2h2zm4 0h-2v2h2zM7 17H5v2h2zm4 0H9v2h2zm4 0h-2v2h2z"/>',

  box: '<path d="M12 2 3 6.1l9 4.1 9-4.1z"/><path d="M2 8v9.4l9 4.2v-9.5zm11 13.6 9-4.2V8l-9 4.1z"/>',

  clipboard: '<path d="M9 2h6a1 1 0 0 1 1 1v1H8V3a1 1 0 0 1 1-1z"/><path fill-rule="evenodd" d="M6 4v18h12V4h-1v2H7V4zm2.5 6h7v1.6h-7zm0 3.4h7V15h-7zm0 3.4h4.5v1.6H8.5z"/>',

  trash: '<path d="M9 2h6l1 2h4v2H4V4h4z"/><path fill-rule="evenodd" d="M5.5 8h13l-.9 12.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9zm4 2.5v8h1.6v-8zm3.4 0v8h1.6v-8z"/>',

  pencil: '<path d="m3 17.3 10.6-10.6 4 4L7 21.3H3zM19.9 3.7a1.6 1.6 0 0 1 0 2.3l-1.2 1.2-4-4L15.9 2a1.6 1.6 0 0 1 2.3 0z"/>',

  save: '<path fill-rule="evenodd" d="M4 3h12.2L21 7.8V19a2 2 0 0 1-2 2h-1v-7.5H6V21H5a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1zm3 1.8v4.4h8V4.8z"/><path d="M7.5 15h9v6h-9z"/>',

  printer: '<path d="M6 2h12v5H6z"/><path fill-rule="evenodd" d="M3.5 8.5h17a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H18v-5H6v5H3.5A1.5 1.5 0 0 1 2 16.5V10a1.5 1.5 0 0 1 1.5-1.5zm14.3 2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z"/><path d="M7.5 14.5h9V22h-9z"/>',

  search: '<path fill-rule="evenodd" d="M10.6 2a8.6 8.6 0 1 0 5.2 15.4l4.4 4.4 1.8-1.8-4.4-4.4A8.6 8.6 0 0 0 10.6 2zm0 2.4a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4z"/>',

  users: '<path d="M9.2 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM9.2 14C5.3 14 2 15.9 2 18.6V21h14.4v-2.4c0-2.7-3.3-4.6-7.2-4.6z"/><path d="M17.4 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm.6 1.6c-.4 0-.8 0-1.2.1 1.1 1.2 1.8 2.8 1.8 4.6V21H22v-2.7c0-2.6-1.8-4.7-4-4.7z"/>',

  user: '<path d="M12 12.4a4.7 4.7 0 1 0 0-9.4 4.7 4.7 0 0 0 0 9.4zM12 14c-4.4 0-8 2.2-8 5.1V21h16v-1.9c0-2.9-3.6-5.1-8-5.1z"/>',

  employee: '<path d="M12 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z"/><path fill-rule="evenodd" d="M9.4 12.7 12 15.4l2.6-2.7c3.4.5 5.9 2.5 5.9 5V21h-17v-3.3c0-2.5 2.5-4.5 5.9-5zM12 17.2l-1.1 1.2 1.1 1.2 1.1-1.2z"/>',

  bag: '<path fill-rule="evenodd" d="M12 2a4 4 0 0 0-4 4v1H4.6L3 21.5h18L19.4 7H16V6a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v1h-4V6a2 2 0 0 1 2-2z"/>',

  receipt: '<path fill-rule="evenodd" d="M4 2h16v20l-2.7-1.8-2.6 1.8-2.7-1.8L9.3 22l-2.6-1.8L4 22zm3 4v1.8h10V6zm0 4.6v1.8h10v-1.8zm0 4.6V17h6.5v-1.8z"/>',

  banknote: '<path fill-rule="evenodd" d="M2 5.5h20v13H2zm10 2.6a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8zM5.2 8.3a2 2 0 0 1-1.8 1.8v3.8a2 2 0 0 1 1.8 1.8h13.6a2 2 0 0 1 1.8-1.8v-3.8a2 2 0 0 1-1.8-1.8z"/>',

  coins: '<path fill-rule="evenodd" d="M9 3c-3.9 0-7 1.6-7 3.6S5.1 10.2 9 10.2s7-1.6 7-3.6S12.9 3 9 3zM2 9.1v2.4c0 2 3.1 3.6 7 3.6.6 0 1.2 0 1.7-.1a5.6 5.6 0 0 1-.2-1.5v-.4c-.5.1-1 .1-1.5.1-2.9 0-5.4-.9-7-2.2z"/><path fill-rule="evenodd" d="M17 12c-2.8 0-5 1.2-5 2.8v3.4c0 1.6 2.2 2.8 5 2.8s5-1.2 5-2.8v-3.4c0-1.6-2.2-2.8-5-2.8zm0 1.8c1.9 0 3.2.7 3.2 1s-1.3 1-3.2 1-3.2-.7-3.2-1 1.3-1 3.2-1z"/><path d="M2 13.7v1.6c0 1.7 2.3 3.1 5.4 3.5a4 4 0 0 1-.4-1.6v-1c-2.1-.4-3.9-1.3-5-2.5z"/>',

  chart: '<path d="M3 20.4h18V22H3z"/><rect x="4" y="11" width="3.6" height="8" rx=".8"/><rect x="10.2" y="5.5" width="3.6" height="13.5" rx=".8"/><rect x="16.4" y="8.5" width="3.6" height="10.5" rx=".8"/>',

  trending: '<path d="M3 20.4h18V22H3z"/><path d="M22 4h-6.5l2.2 2.2-4.4 4.4-3.5-3.5L2 14.9l1.7 1.7 6.1-6.1 3.5 3.5 6.1-6.1L21.6 10z"/>',

  gear: '<path fill-rule="evenodd" d="m9.9 2-.4 2.7-2 1.2-2.5-1.1-2.1 3.6L4.9 10a7.7 7.7 0 0 0 0 2.3l-2 1.6 2.1 3.6 2.5-1.1 2 1.2.4 2.7h4.2l.4-2.7 2-1.2 2.5 1.1 2.1-3.6-2-1.6a7.7 7.7 0 0 0 0-2.3l2-1.6-2.1-3.6-2.5 1.1-2-1.2L14.1 2zM12 8.3a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z"/>',

  bell: '<path d="M12 2a1.6 1.6 0 0 1 1.6 1.6v.7A6.7 6.7 0 0 1 18.7 11v4l1.8 2.6v1.1H3.5v-1.1L5.3 15v-4a6.7 6.7 0 0 1 5.1-6.7v-.7A1.6 1.6 0 0 1 12 2z"/><path d="M9.4 20a2.7 2.7 0 0 0 5.2 0z"/>',

  bellDesk: '<path d="M12 3.8a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z"/><path d="M12 5a8 8 0 0 0-8 8v2h16v-2a8 8 0 0 0-8-8z"/><path d="M2 16.5h20V19H2z"/>',

  tag: '<path fill-rule="evenodd" d="M12.6 2H21a1 1 0 0 1 1 1v8.4a2 2 0 0 1-.6 1.4l-8.6 8.6a2 2 0 0 1-2.8 0l-7.4-7.4a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 1.4-.6zm5.1 3.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8z"/>',

  pin: '<path fill-rule="evenodd" d="M12 2a7.6 7.6 0 0 0-7.6 7.6C4.4 15.3 12 22.5 12 22.5s7.6-7.2 7.6-12.9A7.6 7.6 0 0 0 12 2zm0 4.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>',

  factory: '<path d="M2 21.5V9.7l6 3.4V9.7l6 3.4V9.7l6 3.4V3.5h4v18zM6 16v3h2.5v-3zm5.5 0v3H14v-3zm5.5 0v3h2.5v-3z"/>',

  flame: '<path d="M13.4 1.6c.9 3.3-.5 5.4-2 7.3-1.6 2-3.3 3.9-3.3 7.1a5.9 5.9 0 0 0 11.8 0c0-4.2-3.5-8.2-6.5-14.4zM9.2 12.9C7.7 14.2 6 15.9 6 18.2A5.4 5.4 0 0 0 8.3 22.6 6.6 6.6 0 0 1 6.7 18c0-2 .9-3.5 2.5-5.1z"/>',

  wrench: '<path d="M20.8 6.3 17.5 9.6l-3.1-3.1 3.3-3.3a6.2 6.2 0 0 0-8.1 7.4L2 17.2 5.5 20.7l6.6-7.6a6.2 6.2 0 0 0 7.4-8.1z"/>',

  flask: '<path fill-rule="evenodd" d="M9 2h6v1.9h-1.1v5.4l5.5 9.5A2.2 2.2 0 0 1 17.5 22h-11a2.2 2.2 0 0 1-1.9-3.3l5.5-9.5V3.9H9zm3 8.6-2.9 5h5.8z"/>',

  clock: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 4.4h2v5.2l3.6 2.2-1 1.7L11 12.7z"/>',

  timer: '<path d="M9 1h6v2H9z"/><path fill-rule="evenodd" d="M12 3.8a9.1 9.1 0 1 0 0 18.2 9.1 9.1 0 0 0 0-18.2zm-1 3.9h2v5.4l3.4 2-1 1.7-4.4-2.6z"/>',

  file: '<path fill-rule="evenodd" d="M5 2h9l5 5v15H5zm8 1.8V8h4.2zM7.8 11.5v1.8h8.4v-1.8zm0 3.7v1.8h8.4v-1.8z"/>',

  plus: '<path d="M10.6 3h2.8v7.6H21v2.8h-7.6V21h-2.8v-7.6H3v-2.8h7.6z"/>',

  check: '<path d="m9.4 18.2-6.6-6.6 2-2 4.6 4.6L19.2 4.4l2 2z"/>',

  checkCircle: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.4 14.4-4.4-4.4 1.6-1.6 2.8 2.8 5.6-5.6 1.6 1.6z"/>',

  x: '<path d="M19.4 6.2 17.8 4.6 12 10.4 6.2 4.6 4.6 6.2 10.4 12l-5.8 5.8 1.6 1.6L12 13.6l5.8 5.8 1.6-1.6L13.6 12z"/>',

  xCircle: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.6 12.2-1.4 1.4L12 13.4l-2.2 2.2-1.4-1.4L10.6 12 8.4 9.8l1.4-1.4L12 10.6l2.2-2.2 1.4 1.4L13.4 12z"/>',

  userCheck: '<path d="M10 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10 13.6c-4.2 0-7.6 2.1-7.6 4.8V21h11.1l-2.2-2.2 3.4-3.4 1.5 1.5-.2-2c-1.7-.8-3.8-1.3-6-1.3z"/><path d="m16.6 20.4-3.1-3.1 1.6-1.6 1.5 1.5 4.1-4.1 1.6 1.6z"/>',

  userX: '<path d="M10 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10 13.6c-4.2 0-7.6 2.1-7.6 4.8V21h10.3v-1.6l-1.5-1.5 2.6-2.6a19 19 0 0 0-3.8-.4z"/><path d="m22 15.9-1.4-1.4-2 2-2-2-1.4 1.4 2 2-2 2 1.4 1.4 2-2 2 2 1.4-1.4-2-2z"/>',

  warning: '<path fill-rule="evenodd" d="M12 2.2 22.6 20.6H1.4zm-1.1 6.1v6h2.2v-6zm0 7.6v2.2h2.2v-2.2z"/>',

  sparkle: '<path d="M12 1.5 14 8l6.5 2-6.5 2-2 6.5-2-6.5L3.5 10 10 8z"/><path d="M19 14.5 20 17.5 23 18.5 20 19.5 19 22.5 18 19.5 15 18.5 18 17.5z"/><path d="M5 1 5.8 3.2 8 4 5.8 4.8 5 7 4.2 4.8 2 4 4.2 3.2z"/>',

  phone: '<path d="M6.6 2.5 9.5 8 7 10.2a14.6 14.6 0 0 0 6.8 6.8L16 14.5l5.5 2.9-1.4 3.5a2 2 0 0 1-2.2 1.2C9.4 20.6 3.4 14.6 1.9 6.1A2 2 0 0 1 3.1 3.9z"/>',

  arrowLeft: '<path d="M11.4 3.6 3 12l8.4 8.4 1.9-1.9-5.1-5.1H21v-2.8H8.2l5.1-5.1z"/>',

  arrowRight: '<path d="M12.6 3.6 21 12l-8.4 8.4-1.9-1.9 5.1-5.1H3v-2.8h12.8l-5.1-5.1z"/>',

  undo: '<path d="M9.6 4.4 4 10l5.6 5.6 2-2-2.2-2.2h5.1a3.9 3.9 0 0 1 0 7.8h-3.2V22h3.2a6.7 6.7 0 0 0 0-13.4H9.4l2.2-2.2z"/>',

  refresh: '<path d="M12 3.5a8.5 8.5 0 0 0-8.2 6.3l2.7.7A5.7 5.7 0 0 1 12 6.3c1.7 0 3.3.8 4.3 2H14v2.8h6.6V4.5h-2.8v1.8A8.5 8.5 0 0 0 12 3.5z"/><path d="M12 20.5a8.5 8.5 0 0 0 8.2-6.3l-2.7-.7a5.7 5.7 0 0 1-5.5 4.2c-1.7 0-3.3-.8-4.3-2H10v-2.8H3.4v6.6h2.8v-1.8a8.5 8.5 0 0 0 5.8 2.3z"/>',

  menu: '<path d="M3 5.4h18v2.6H3zm0 5.3h18v2.6H3zm0 5.3h18v2.6H3z"/>',

  card: '<path fill-rule="evenodd" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5V8H3zM3 11v6.5A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5V11zm3 4.2h5v2H6z"/>',

  target: '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2zm0 2.6a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z"/>',

  circle: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6z"/>',

  circleHalf: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6z"/><path d="M12 6.6a5.4 5.4 0 0 1 0 10.8z"/>',

  hourglass: '<path d="M5 2h14v2h-2v2.6L12 11 7 6.6V4H5zm2 15.4L12 13l5 4.4V20h2v2H5v-2h2z"/>',

  lock: '<path fill-rule="evenodd" d="M12 2a5 5 0 0 0-5 5v3H5.8A1.8 1.8 0 0 0 4 11.8v8.4A1.8 1.8 0 0 0 5.8 22h12.4a1.8 1.8 0 0 0 1.8-1.8v-8.4A1.8 1.8 0 0 0 18.2 10H17V7a5 5 0 0 0-5-5zm0 2.2A2.8 2.8 0 0 1 14.8 7v3H9.2V7A2.8 2.8 0 0 1 12 4.2zm0 9.3a1.8 1.8 0 0 1 1 3.3V19h-2v-2.2a1.8 1.8 0 0 1 1-3.3z"/>',

  download: '<path d="M11 3h2v8.2l3.1-3.1 1.4 1.4L12 15.4 6.5 9.5l1.4-1.4L11 11.2z"/><path d="M4 17h16v2.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z"/>',

  camera: '<path fill-rule="evenodd" d="M9.2 3h5.6l1.4 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.8zM12 8.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>',

  moneyBag: '<path d="M8.9 2h6.2l1.7 3.3a1 1 0 0 1-.9 1.5H8.1a1 1 0 0 1-.9-1.5z"/><path fill-rule="evenodd" d="M8.3 8.3h7.4c2.5 1.9 4.5 4.9 4.5 8 0 3.7-2.9 5.7-8.2 5.7S3.8 20 3.8 16.3c0-3.1 2-6.1 4.5-8zm4.4 1.9h-1.4v1c-1.4.2-2.4 1.1-2.4 2.4 0 1.4 1 2.1 2.6 2.5 1 .3 1.3.5 1.3.9s-.4.6-1.1.6c-.9 0-1.7-.3-2.2-.8l-1 1.5c.6.5 1.4.9 2.4 1v1.1h1.4v-1.1c1.6-.2 2.6-1.1 2.6-2.5 0-1.4-1-2-2.6-2.5-1-.3-1.3-.5-1.3-.8 0-.4.4-.6 1-.6.7 0 1.4.2 1.9.6l.9-1.5c-.5-.4-1.2-.7-1.9-.8z"/>',
};


/* emoji -> icon name. Anything not listed here stays the character it was. */
export const EMOJI = {
  '🏠': 'home', '🗂': 'board', '👓': 'glasses', '👁': 'eye', '📅': 'calendar',
  '📦': 'box', '📋': 'clipboard', '🗑': 'trash', '✎': 'pencil', '💾': 'save',
  '🖨': 'printer', '🔎': 'search', '🔍': 'search', '👥': 'users', '👤': 'user',
  '🧑‍💼': 'employee', '🛍': 'bag', '🧾': 'receipt', '💸': 'banknote', '💰': 'coins',
  '📊': 'chart', '📈': 'trending', '⚙️': 'gear', '⚙': 'gear', '🔔': 'bell',
  '🛎': 'bellDesk', '🏷': 'tag', '📍': 'pin', '🏭': 'factory', '🔥': 'flame',
  '🔧': 'wrench', '🧪': 'flask', '🕰': 'clock', '⏱': 'timer', '📜': 'file',
  '➕': 'plus', '✔': 'check', '✓': 'check', '✅': 'checkCircle', '✕': 'x',
  '❌': 'xCircle', '🚶': 'userCheck', '👻': 'userX', '⚠': 'warning', '🎉': 'sparkle',
  '☎': 'phone', '←': 'arrowLeft', '→': 'arrowRight', '↩': 'undo', '↻': 'refresh',
  '☰': 'menu', '💳': 'card', '🎯': 'target', '○': 'circle', '●': 'circleHalf',
  '⏳': 'hourglass', '🔒': 'lock', '↧': 'download', '📷': 'camera', '📄': 'file',
  '✏': 'pencil', '✨': 'sparkle', '⛔': 'xCircle',
};


/** an emoji, an icon name, or something we do not draw */
export const iconName = (key) => (SHAPES[key] ? key : EMOJI[key] || null);
