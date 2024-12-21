**README.md**  
------------------------------  

# Aggiorna ID_PIPEDRIVE su DB SQL da CSV di Pipedrive  

Questo script Node.js consente di aggiornare una tabella SQL Server basandosi sull'export CSV di [Pipedrive.com](https://pipedrive.com).  
Lo scopo è sincronizzare il campo `ID_PIPEDRIVE` in una tabella SQL locale, sfruttando un campo personalizzato di Pipedrive che contiene l'ID della tabella SQL.  

## Requisiti principali  

1. **Estrazione iniziale** da SQL su un file Excel che include l'ID univoco della tabella (es. `CLI_ID`).  
2. **Importazione in Pipedrive** del file Excel, creando un **campo personalizzato** in Pipedrive in cui inserire l'ID SQL (`CLI_ID`).  
3. **Esportazione da Pipedrive** in formato CSV. Questo file CSV conterrà:
   - La colonna con l'ID SQL (`CLI_ID` o simile).  
   - L'ID interno di Pipedrive per ogni riga (es. `ID`).  
4. **Esecuzione** di questo script per aggiornare la tabella SQL locale con l'ID di Pipedrive, in corrispondenza dell'ID SQL.  

## Installazione  

1. **Clona** o scarica questo repository.  
2. **Installa** le dipendenze:  
   ```bash
   npm install
   ```  

## Configurazione  

Creare un file `.env` (nella stessa cartella di `app.js`) con i parametri di configurazione. Ad esempio:  

```
# Dati connessione DB
DB_SERVER=localhost
DB_USER=sa
DB_PASSWORD=yourStrong(!)Password
DB_DATABASE=nomeDelDb
DB_PORT=1433

# Definizione tabella SQL e colonne
TABLE_NAME=T_ANAGRAFICA
JOIN_COLUMN_DB=CLI_ID        # Nome colonna in SQL che contiene l'ID univoco
JOIN_COLUMN_CSV=MUNUS_ID     # Nome colonna nel CSV che contiene lo stesso ID
UPDATE_COLUMN_DB=ID_PIPEDRIVE
UPDATE_COLUMN_CSV=ID         # Nome colonna nel CSV con l'ID di Pipedrive

# Posizione file CSV di Pipedrive
CSV_FILEPATH=./file.csv

# Modalità TEST: se true, non esegue le query ma stampa solo i primi 10 statement
TEST=false
```

### Spiegazione rapida delle variabili  

- **`DB_*`**: Parametri di connessione a SQL Server (server, utente, password, db, port).  
- **`TABLE_NAME`**: Tabella su cui eseguire l'UPDATE.  
- **`JOIN_COLUMN_DB`**: Nome colonna della tabella SQL che contiene l'ID univoco (quello che abbiamo importato in Pipedrive come campo personalizzato).  
- **`JOIN_COLUMN_CSV`**: Nome colonna corrispondente nel CSV di Pipedrive (dove è stato salvato il medesimo ID univoco).  
- **`UPDATE_COLUMN_DB`**: Campo della tabella SQL da aggiornare (es. `ID_PIPEDRIVE`).  
- **`UPDATE_COLUMN_CSV`**: Nome della colonna nel CSV di Pipedrive che contiene l'ID Pipedrive stesso (es. `ID`).  
- **`CSV_FILEPATH`**: Percorso del file CSV esportato da Pipedrive.  
- **`TEST`**: Se è `true`, non aggiorna la tabella e mostra a schermo le prime 10 query di esempio.  

## Utilizzo  

1. **Configura** correttamente il file `.env` con i tuoi parametri di ambiente.  
2. **Posiziona** il file CSV esportato da Pipedrive nella posizione indicata da `CSV_FILEPATH`.  
3. **Avvia** lo script:  
   ```bash
   npm start
   ```  
   Oppure:  
   ```bash
   node app.js
   ```  

### Flusso di lavoro consigliato  

1. Estrarre i dati da SQL (incluso l’ID univoco) su Excel.  
2. Importare il file Excel in Pipedrive, creando un **campo personalizzato** in Pipedrive per memorizzare l’ID SQL.  
3. Aggiornare e lavorare sui dati in Pipedrive.  
4. Esportare da Pipedrive un CSV contenente:  
   - L’ID univoco SQL (cioè il campo personalizzato).  
   - L’ID di Pipedrive (campo `ID`).  
5. Eseguire questo script per aggiornare la tabella SQL con l’ID di Pipedrive, in corrispondenza dell’ID SQL univoco.  

## Funzionalità aggiuntive  

- Se nel CSV vengono rilevati **duplicati** basati sulla colonna `JOIN_COLUMN_CSV`, lo script **genera un file `duplicati.csv`** che elenca tutte le righe duplicate, escludendole dal processo di update.  
- Se ci sono righe senza l’ID univoco (`JOIN_COLUMN_CSV` vuoto), vengono ignorate e indicate nel log.  
- Se la colonna di join o la colonna da aggiornare non esistono né in SQL né nel CSV, lo script segnala l’errore e termina.  

## Note finali  

- **Modalità TEST** (`TEST=true`): lo script non aggiorna niente sul DB, ma stampa a schermo le prime 10 query che **sarebbero** eseguite, fornendo la possibilità di controllare.  
- In caso di **errori di connessione** o **errori nelle query**, lo script termina restituendo l’errore relativo.  
- Lo script **esegue batch di update** e gestisce una **transazione** per garantire l’integrità dei dati. Se qualcosa va storto, viene eseguito un rollback.  