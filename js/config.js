// 실시간 공유 설정
//
// mode
//   'auto'     : firebase 설정이 있으면 Firebase, 없으면 공개 MQTT 중계 서버 (설정 없이 바로 동작)
//                server.js 로 실행하면 자동으로 'ws' 가 됩니다
//   'firebase' : 내 Firebase Realtime Database (안정적으로 오래 쓸 때 추천)
//   'mqtt'     : 공개 MQTT 중계 서버 (계정·서버 필요 없음, 무료 공용 서버라 가끔 느리거나 데이터가 지워질 수 있음)
//   'ws'       : server.js (Node) 웹소켓 서버
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

  // 공개 MQTT 중계 서버 (앞에서부터 차례로 연결 시도)
  mqtt: {
    brokers: ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'],
    prefix: 'wow-raid-planner/v1'
  },

  // server.js 를 다른 주소에서 실행할 때만 지정 (예: 'wss://raid.example.com/ws')
  wsUrl: '',

  // 주소에 ?room= 이 없을 때 열 작전판 이름 (비우면 새 작전판을 만듭니다)
  defaultRoom: ''
};
