// Stub para `require('...tflite')` no Jest. O modelo real (~5MB binário) não
// pode ser carregado como módulo JS; em runtime é um asset do Metro. Nos testes
// o `react-native-fast-tflite` é mockado (jest.setup.js), então este valor só
// serve de placeholder do argumento passado para loadTensorflowModel.
module.exports = 1;
