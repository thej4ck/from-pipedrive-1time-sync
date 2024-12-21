require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const sql = require('mssql');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const {
  DB_SERVER,
  DB_USER,
  DB_PASSWORD,
  DB_DATABASE,
  DB_PORT,
  TABLE_NAME,
  JOIN_COLUMN_DB,
  JOIN_COLUMN_CSV,
  UPDATE_COLUMN_DB,
  UPDATE_COLUMN_CSV,
  CSV_FILEPATH,
  TEST
} = process.env;

(async () => {
  // Verifica CSV esistente
  const csvPath = path.resolve(CSV_FILEPATH || '');
  if (!fs.existsSync(csvPath)) {
    console.error('File CSV non trovato:', csvPath);
    process.exit(1);
  }

  // Connessione al DB
  const config = {
    server: DB_SERVER,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    options: { trustServerCertificate: true },
    port: parseInt(DB_PORT, 10) || 1433
  };
  let pool;
  try {
    pool = await sql.connect(config);
    console.log('Connessione al DB riuscita.');
  } catch (err) {
    console.error('Errore di connessione al DB:', err);
    process.exit(1);
  }

  // Verifica esistenza colonne in DB
  try {
    const dbCols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='${TABLE_NAME}'
    `);
    const dbColNames = dbCols.recordset.map((r) => r.COLUMN_NAME.toUpperCase());
    if (
      !dbColNames.includes(JOIN_COLUMN_DB.toUpperCase()) ||
      !dbColNames.includes(UPDATE_COLUMN_DB.toUpperCase())
    ) {
      console.error(
        `Colonne ${JOIN_COLUMN_DB} o ${UPDATE_COLUMN_DB} non presenti nella tabella ${TABLE_NAME}.`
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('Errore nel recupero colonne DB:', err);
    process.exit(1);
  }

  // Legge il CSV e controlla intestazioni
  let csvHeaders = [];
  let csvHeadersOk = false;
  let csvHasJoinCol = false;
  let csvHasUpdateCol = false;
  let totalRows = 0;
  let emptyJoinRows = 0;

  // Per gestire righe duplicati
  const allRowsByKey = {};

  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on('headers', (headers) => {
        csvHeaders = headers;
        csvHasJoinCol = headers.map((h) => h.toUpperCase()).includes(JOIN_COLUMN_CSV.toUpperCase());
        csvHasUpdateCol = headers.map((h) => h.toUpperCase()).includes(UPDATE_COLUMN_CSV.toUpperCase());
        if (!csvHasJoinCol || !csvHasUpdateCol) {
          console.error(`Colonne ${JOIN_COLUMN_CSV} o ${UPDATE_COLUMN_CSV} non trovate nel CSV.`);
          reject();
        } else {
          csvHeadersOk = true;
        }
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('data', (row) => {
        totalRows++;
        const joinVal = row[JOIN_COLUMN_CSV]?.toString().trim() || '';

        if (!joinVal) {
          emptyJoinRows++;
          return;
        }

        if (!allRowsByKey[joinVal]) {
          allRowsByKey[joinVal] = [];
        }
        allRowsByKey[joinVal].push(row);
      })
      .on('end', () => {
        if (!csvHeadersOk) {
          reject();
          return;
        }
        resolve();
      });
  }).catch((err) => {
    if (err) console.error('Errore nella lettura del CSV:', err);
    process.exit(1);
  });

  console.log(`Righe totali CSV: ${totalRows}`);
  console.log(`Righe senza ${JOIN_COLUMN_CSV}: ${emptyJoinRows}`);

  // Separiamo righe uniche vs duplicati
  let dataRows = [];
  let duplicatesList = [];

  Object.keys(allRowsByKey).forEach((key) => {
    const rowsForKey = allRowsByKey[key];
    if (rowsForKey.length > 1) {
      console.warn(`Trovati duplicati nel CSV per chiave '${key}'. Salto i record interessati...`);
      // Tutte le righe relative a questa chiave finiscono tra i duplicati
      duplicatesList.push(...rowsForKey);
    } else {
      dataRows.push(rowsForKey[0]);
    }
  });

  console.log(`Righe utilizzabili dopo rimozione duplicati: ${dataRows.length}`);

  // Se esistono duplicati, salviamoli in duplicati.csv
  if (duplicatesList.length > 0) {
    // Prepara la struttura per csv-writer
    // Creiamo un array di oggetti con stessi campi delle colonne originali
    const csvWriter = createCsvWriter({
      path: 'duplicati.csv',
      header: csvHeaders.map((h) => ({ id: h, title: h }))
    });

    try {
      await csvWriter.writeRecords(duplicatesList);
      console.log(`File duplicati.csv generato con ${duplicatesList.length} righe duplicate.`);
    } catch (err) {
      console.error('Errore nella scrittura di duplicati.csv:', err);
    }
  }

  // Se dopo aver tolto i duplicati non resta nulla, usciamo
  if (dataRows.length === 0) {
    console.log('Nessun record da elaborare dopo rimozione duplicati.');
    pool.close();
    process.exit(0);
  }

  // Preleva i record corrispondenti dal DB
  let dbValues = {};
  try {
    const joinValuesList = dataRows
      .map((d) => `'${d[JOIN_COLUMN_CSV]?.toString().trim()}'`)
      .join(',');

    const querySelect = `
      SELECT [${JOIN_COLUMN_DB}] AS joinVal, [${UPDATE_COLUMN_DB}] AS updateVal
      FROM [${TABLE_NAME}]
      WHERE [${JOIN_COLUMN_DB}] IN (${joinValuesList})
    `;
    const result = await pool.request().query(querySelect);

    result.recordset.forEach((row) => {
      const rowKey = row.joinVal ? row.joinVal.toString().trim() : '';
      const rowValue = row.updateVal ? row.updateVal.toString().trim() : '';
      dbValues[rowKey] = rowValue;
    });

    // Conta righe totali in DB
    const countAll = await pool.request().query(`SELECT COUNT(*) as c FROM [${TABLE_NAME}]`);
    console.log(`Righe totali presenti in DB nella tabella ${TABLE_NAME}: ${countAll.recordset[0].c}`);
  } catch (err) {
    console.error('Errore nel recupero dei dati dal DB:', err);
    pool.close();
    process.exit(1);
  }

  // Costruisce le query di update solo se necessario
  let updateEntries = [];
  dataRows.forEach((row) => {
    const joinVal = row[JOIN_COLUMN_CSV]?.toString().trim() || '';
    const updateVal = row[UPDATE_COLUMN_CSV]?.toString().trim() || '';

    // Se non esiste in DB, skip
    if (dbValues[joinVal] === undefined) return;

    // Esegui update solo se il valore in DB è assente o diverso
    if (!dbValues[joinVal] || dbValues[joinVal] !== updateVal) {
      updateEntries.push({ joinVal, updateVal });
    }
  });
  console.log(`Righe che subiranno update: ${updateEntries.length}`);

  // Se non ci sono update da fare, esce
  if (updateEntries.length === 0) {
    console.log('Nessun update necessario.');
    pool.close();
    process.exit(0);
  }

  // Modalità TEST
  if (TEST === 'true') {
    console.log('\n--- MODALITA\' TEST ---');
    console.log('Prime 10 query di esempio:');
    updateEntries.slice(0, 10).forEach((e, i) => {
      console.log(
        `Query #${i + 1}:\nUPDATE ${TABLE_NAME}\n` +
        `  SET ${UPDATE_COLUMN_DB} = '${e.updateVal}'\n` +
        `  WHERE ${JOIN_COLUMN_DB} = '${e.joinVal}';`
      );
    });
    pool.close();
    process.exit(0);
  }

  // Se non è test, esegue update con transazione e batching
  console.log('Inizio aggiornamenti...');
  const batchSize = 500;
  let updatedCount = 0;

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    // Esempio di disabilitazione indici (se necessario e se hai i permessi):
    // await pool.request().query(`ALTER INDEX [IndexName] ON [${TABLE_NAME}] DISABLE;`);

    for (let i = 0; i < updateEntries.length; i += batchSize) {
      const batch = updateEntries.slice(i, i + batchSize);
      const request = new sql.Request(transaction);
      const batchQueries = batch
        .map(
          (e) => `
        UPDATE [${TABLE_NAME}]
        SET [${UPDATE_COLUMN_DB}] = '${e.updateVal}'
        WHERE [${JOIN_COLUMN_DB}] = '${e.joinVal}';
      `
        )
        .join('\n');

      try {
        await request.batch(batchQueries);
      } catch (err) {
        console.error('Errore nell\'esecuzione della batch:\n', batchQueries, '\n', err);

        // Se avevi disabilitato indici, qui andrebbero riabilitati
        // await pool.request().query(`ALTER INDEX [IndexName] ON [${TABLE_NAME}] REBUILD;`);

        await transaction.rollback();
        pool.close();
        process.exit(1);
      }

      updatedCount += batch.length;
      if (updatedCount % 100 === 0 || updatedCount === updateEntries.length) {
        console.log(`Aggiornati finora ${updatedCount} di ${updateEntries.length}...`);
      }
    }

    // Riabilita eventuali indici
    // await pool.request().query(`ALTER INDEX [IndexName] ON [${TABLE_NAME}] REBUILD;`);

    await transaction.commit();
    console.log('Transazione completata con successo.');
  } catch (err) {
    console.error('Errore generale durante l\'update:', err);
    try {
      await transaction.rollback();
    } catch (e) {
      console.error('Errore durante il rollback:', e);
    }
    pool.close();
    process.exit(1);
  }

  pool.close();
  process.exit(0);
})();
