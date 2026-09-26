# Permisos repetidos del Llavero — 23 de septiembre de 2026

**Corrección del 24 de septiembre:** esta solución era incompleta. El Llavero
sigue usando una partición por `cdhash` para el certificado local, aunque el
requisito designado permanezca estable. Causa verificada y solución posterior
en [keychain-credentials.md](keychain-credentials.md). El texto siguiente conserva
el recibo histórico y no es una garantía de que la firma local baste.

La app mostraba repetidamente el aviso de contraseña del Llavero después de
«Permitir siempre». El bundle debug se firmaba con `codesign --sign -`: cada
compilación cambiaba su hash de firma ad hoc. El permiso permanente del Llavero
se asocia a la identidad de código de la app, por lo que una compilación nueva
podía volver a pedir autorización para las claves ya guardadas.

`scripts/build-macos.sh` exige ahora una identidad local estable, firma con ella
la biblioteca incluida y `Datolens.app`, verifica el bundle y comprueba que el
requisito designado contiene el certificado esperado. La identidad local
«Datolens Local Development Signing» se instaló en el Llavero de inicio de
sesión de este Mac, con confianza limitada a firma de código. Para preparar
otro Mac se puede ejecutar `python3 scripts/setup-local-signing.py` una vez.
Las claves Gemini/Jev existentes siguen en el mismo servicio del Llavero;
no se han leído, sustituido ni eliminado durante esta corrección.

Comprobación: `scripts/build-macos.sh` terminó con código 0, frontend y Rust
compilaron, `codesign --verify --deep --strict` pasó y el requisito designado
del bundle es `identifier "com.victoriano.datolens" and certificate leaf =
H"aa46ab80a2e9cab87478bca62bb364087714e091"`. El script de preparación
se ejecutó por segunda vez y conservó la misma identidad.

Pendiente: la instancia que estaba abierta durante el build ejecuta aún su
código anterior. Debe cerrarse y abrirse el bundle nuevo. Las entradas creadas
por la firma ad hoc anterior pueden pedir una última autorización por clave;
después de pulsar «Permitir siempre», una nueva compilación con la misma
identidad ya no debería volver a pedirla. No se ha verificado ese último paso
con una clave real porque requeriría actuar sobre el diálogo protegido de
macOS y usar los secretos del usuario.
