import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Rent Collection</CardTitle>
          <CardDescription>Sign in as a manager, staff member or tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
