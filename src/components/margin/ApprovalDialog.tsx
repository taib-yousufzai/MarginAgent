import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStore } from "@/lib/agent/store";

export function ApprovalDialog() {
  const { pendingApproval, resolveApproval } = useStore();

  return (
    <AlertDialog open={Boolean(pendingApproval)}>
      <AlertDialogContent className="bg-surface-raised sm:max-w-[520px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-[18px]">
            {pendingApproval?.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13.5px] leading-6">
            {pendingApproval?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1.5 rounded-xl bg-surface p-4 font-mono text-[12.5px] text-muted-foreground">
          {(pendingApproval?.details ?? []).map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => pendingApproval && resolveApproval(pendingApproval.id, false)}
          >
            Reject
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => pendingApproval && resolveApproval(pendingApproval.id, true)}
          >
            Approve
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
