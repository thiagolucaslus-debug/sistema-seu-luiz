; Administracao Financeira — Smart NSIS Installer
; - Permite escolher qualquer disco/pasta (C:\, D:\, E:\, etc.) em qualquer PC Windows.
; - Se o disco D:\ existir e nenhuma pasta anterior estiver gravada, sugere D:\AdministracaoFinanceira por padrao.
; - Encerra instancias anteriores automaticamente antes de instalar ou atualizar.

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  ${StdUtils.GetParameter} $R9 "D" ""
  ${If} $R9 == ""
  ${AndIf} $perUserInstallationFolder == ""
  ${AndIf} ${FileExists} "D:\*.*"
    StrCpy $INSTDIR "D:\AdministracaoFinanceira"
  ${EndIf}
!macroend
