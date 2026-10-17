#47 Driver upload: multi-PSL PDF split like Admin

Admin `POST /avize/extract` and `POST /documents/batches` already call
`materializePdfPageFiles`. Driver `POST /driver-documents` inserted one row per
uploaded file and never split.

Now the driver path builds the same entry list (distinct TRO/PSL → N parts;
same PSL on two pages → 1). Response includes `split_pages` when N > 1 so the
cab toast can say „PDF despărțit în N avize”. Rows stay `uploaded_from = driver`
in one batch.
