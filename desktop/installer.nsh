; Administracao Financeira — Smart NSIS Installer
; - Permite escolher qualquer disco/pasta (C:\, D:\, E:\, etc.) em qualquer PC Windows.
; - Se o disco D:\ existir e nenhuma pasta anterior estiver gravada, sugere D:\AdministracaoFinanceira por padrao.
; - Encerra instancias anteriores automaticamente antes de instalar ou atualizar.
; - Blindagem anti-perda: preserva 100% de $INSTDIR\dados (financeiro.db, uploads, PDFs e sessoes) em upgrades e desinstalacoes.

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
  ; Protege $INSTDIR\dados contra desinstaladores legados (v2.0.0) que executavam RMDir /r $INSTDIR
  ${If} ${FileExists} "$INSTDIR\dados\*.*"
    RMDir /r "$INSTDIR\..\.__adm_fin_dados_upgrade_guard"
    Rename "$INSTDIR\dados" "$INSTDIR\..\.__adm_fin_dados_upgrade_guard"
  ${EndIf}
!macroend

!macro customInstall
  ${If} ${FileExists} "$INSTDIR\..\.__adm_fin_dados_upgrade_guard\*.*"
    ${IfNot} ${FileExists} "$INSTDIR\dados\*.*"
      Rename "$INSTDIR\..\.__adm_fin_dados_upgrade_guard" "$INSTDIR\dados"
    ${EndIf}
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
Function .onUserAbort
  ${If} ${FileExists} "$INSTDIR\..\.__adm_fin_dados_upgrade_guard\*.*"
    ${IfNot} ${FileExists} "$INSTDIR\dados\*.*"
      Rename "$INSTDIR\..\.__adm_fin_dados_upgrade_guard" "$INSTDIR\dados"
    ${EndIf}
  ${EndIf}
FunctionEnd
!endif

!macro customRemoveFiles
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\*.ico"
  ${IfNot} ${isUpdated}
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
