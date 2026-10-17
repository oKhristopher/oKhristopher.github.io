# Publicação do Palavra Viva na Google Play

## Identificação do pacote
- Nome exibido: Palavra Viva
- ID Android: com.khristopher.palavraviva
- Origem web: https://palavra-viva-mybr.onrender.com
- Manifesto PWA: https://palavra-viva-mybr.onrender.com/manifest.json
- Política de privacidade: https://palavra-viva-mybr.onrender.com/privacy.html
- SDK alvo: Android 16 / API 36 (gerado pelo Bubblewrap atual)

## Texto sugerido para a ficha da loja

**Descrição curta**
Encontre passagens bíblicas relacionadas ao que você está vivendo.

**Descrição completa**
O Palavra Viva oferece um espaço de pausa e reflexão para relacionar o que você está vivendo a temas da Bíblia.

Compartilhe em palavras o que está no seu coração. O app identifica um tema, prepara uma resposta contextual e consulta uma fonte bíblica para apresentar uma passagem relacionada. O texto dos versículos é obtido de uma fonte bíblica externa; ele não é inventado pelo modelo de IA.

**Recursos**
- Reflexão por temas como ansiedade, esperança, gratidão, paz e força.
- Consulta de passagens reais da Bíblia.
- Navegação pelos livros bíblicos.
- Histórico e favoritos armazenados no próprio aparelho.
- Limite de até 20 mensagens por dia.

O Palavra Viva é uma ferramenta de reflexão e não substitui aconselhamento pastoral, apoio profissional ou ajuda de emergência. Evite inserir senhas, documentos ou outros dados pessoais sensíveis.

## Como gerar o pacote
O workflow Build Palavra Viva Android App Bundle gera o AAB assinado e um APK de teste. Ele executa o build e os testes de segurança antes de preparar o Android App Bundle.

**Importante sobre a chave:** o workflow gera uma chave de upload temporária para essa primeira compilação e não publica o arquivo de chave como artefato. Ative o Play App Signing ao configurar o app. Para lançar atualizações futuras com uma chave de upload permanente, configure uma chave de upload protegida antes de distribuir a versão ou solicite a redefinição da chave de upload no Play Console.

## Etapas que ainda exigem a conta do proprietário
1. Criar/abrir a conta de desenvolvedor e o app no Play Console.
2. Baixar o artefato palavra-viva-android-release da execução concluída e enviar o AAB.
3. Concluir a ficha da loja, contato de suporte e questionário Segurança dos dados.
4. Após o Play Console disponibilizar o certificado de assinatura do app, copiar a impressão digital SHA-256 (certificado do app, não a chave de upload) para a variável Render ANDROID_APP_SHA256_FINGERPRINT. O build gera então /.well-known/assetlinks.json para verificar a Trusted Web Activity.
5. Se a conta pessoal estiver sujeita à regra de teste, concluir o teste fechado exigido pelo Google Play antes de solicitar acesso à produção.

O arquivo assetlinks.json fica vazio até a impressão digital do certificado de assinatura do app estar configurada. Isso é esperado antes da primeira publicação e precisa ser resolvido antes de considerar a verificação TWA concluída.
