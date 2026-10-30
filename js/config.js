// 실시간 공유 설정
//
// mode
//   'auto'     : firebase 설정이 있으면 Firebase, 없으면 같은 서버의 /ws (server.js),
//                둘 다 안 되면 로컬 모드로 자동 전환
//   'firebase' : Firebase Realtime Database 사용 (서버 없이 정적 사이트에 올릴 때 추천)
//   'ws'       : server.js (Node) 웹소켓 서버 사용
//   'local'    : 같은 브라우저의 탭끼리만 공유 (테스트용)
window.RP = window.RP || {};
window.RP.CONFIG = {
  mode: 'auto',

  // Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에서 복사한 값을 붙여넣으세요.
  // databaseURL 이 비어 있으면 Firebase 를 사용하지 않습니다.
  firebase: {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
    appId: ''
  },

  // server.js 를 다른 주소에서 실행할 때만 지정 (예: 'wss://raid.example.com/ws')
  wsUrl: ''
};
