'use client';
import { QueryParamPage } from '../../../../components/QueryParamPage.jsx';
import { EditLockBar, useEditLock } from '../../../../components/EditLock.jsx';
import { OrderFormView } from '../OrderFormView.jsx';

function EditOrder() {
  const lock = useEditLock(true);
  return (
    <>
      <EditLockBar lock={lock} what="ออเดอร์นี้" />
      <OrderFormView key={lock.formKey} editing locked={lock.locked} onUnlock={lock.unlock} />
    </>
  );
}

export default function EditOrderPage() {
  return (
    <QueryParamPage>
      <EditOrder />
    </QueryParamPage>
  );
}
